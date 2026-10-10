<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { useContextMenu } from '@/composables/useContextMenu'
import { usePageMenu } from '@/composables/usePageMenu'
import { relativeTime } from '@/utils/format'
import {
  branchColor,
  buildMindmap,
  findNode,
  layoutFromTree,
  newUid,
  outlineFromTree,
  toneForDepth,
  treeFromOutline,
} from '@/utils/outline'
import { exportPng, exportSvg } from '@/utils/mindmapExport'

const toast = useToast()
const menu = useContextMenu()
const pageMenu = usePageMenu()

const items = ref([])
const loading = ref(true)
const search = ref('')
const selectedId = ref(null) // number | 'new' | null
const mode = ref('graph') // graph | edit
const layoutMode = ref('tree') // tree | radial
const saving = ref(false)
const confirmOpen = ref(false)

// 画布视图：缩放 + 平移，transform 为 translate(tx,ty) scale(scale)。
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const canvasEl = ref(null)
const panning = ref(false)

// 节点搜索与路径高亮（按 uid）。
const query = ref('')
const matchCursor = ref(0)
const hoverUid = ref(null)
const selectedUid = ref(null)

// 节点 / 卡片操作菜单：右键 / 长按调起全局菜单。
let pressTimer = null
let pressFired = false
let cardPressTimer = null
let cardPressFired = false
const pendingDelete = ref(null)

// 画布内联编辑。
const tree = ref(null)
const editingUid = ref(null)
const editingText = ref('')
const editInputEl = ref(null)

const draft = reactive({ title: '', outline: '' })

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-rose-400 transition'

const DEFAULT_OUTLINE = '中心主题\n  分支一\n    叶子节点\n  分支二\n    另一个叶子'

const EMPTY_LAYOUT = { nodes: [], edges: [], width: 1, height: 1, lineHeight: 15 }

const layout = computed(() => (tree.value ? layoutFromTree(tree.value, layoutMode.value) : EMPTY_LAYOUT))

// 画廊缩略图：为每张导图预生成一份水平树布局。
const thumbs = computed(() => {
  const map = {}
  for (const item of items.value) map[item.id] = buildMindmap(item.outline || '', item.title, 'tree')
  return map
})

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((m) => String(m.title || '').toLowerCase().includes(q))
})

const activeMap = computed(() => items.value.find((m) => m.id === selectedId.value) || null)

const activeUid = computed(() => (hoverUid.value != null ? hoverUid.value : selectedUid.value))

const activeIndex = computed(() => {
  const uid = activeUid.value
  if (uid == null) return -1
  return layout.value.nodes.findIndex((n) => n.uid === uid)
})

const pathIndices = computed(() => {
  const set = new Set()
  const idx = activeIndex.value
  if (idx < 0) return set
  const nodes = layout.value.nodes
  let cur = idx
  while (cur != null && cur >= 0) {
    set.add(cur)
    const parent = nodes[cur]?.parent
    if (parent == null || parent < 0) break
    cur = parent
  }
  return set
})

const pathEdges = computed(() => {
  const set = new Set()
  if (activeIndex.value < 0) return set
  for (const edge of layout.value.edges) if (pathIndices.value.has(edge.child)) set.add(edge.child)
  return set
})

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return layout.value.nodes.filter((n) => n.text.toLowerCase().includes(q)).map((n) => n.uid)
})
const matchSet = computed(() => new Set(matches.value))

const canvasStyle = computed(() => ({
  backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.16) 1px, transparent 1px)',
  backgroundSize: `${24 * scale.value}px ${24 * scale.value}px`,
  backgroundPosition: `${tx.value}px ${ty.value}px`,
}))

const transformStyle = computed(() => ({
  width: `${layout.value.width}px`,
  height: `${layout.value.height}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
}))

function excerpt(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

async function load() {
  loading.value = true
  try {
    items.value = await api.mindmaps.list()
  } catch (err) {
    toast.error(`导图加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function resetInteraction() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
  query.value = ''
  matchCursor.value = 0
  hoverUid.value = null
  selectedUid.value = null
  editingUid.value = null
}

function rebuildTree() {
  tree.value = treeFromOutline(draft.outline, draft.title)
}

function commitTree() {
  if (tree.value) draft.outline = outlineFromTree(tree.value)
}

function nodeByUid(uid) {
  return findNode(tree.value, uid)?.node || null
}

function openMap(map) {
  selectedId.value = map.id
  Object.assign(draft, { title: map.title, outline: map.outline || '' })
  mode.value = 'graph'
  resetInteraction()
  rebuildTree()
  nextTick(() => fitView())
}

function startNew() {
  selectedId.value = 'new'
  Object.assign(draft, { title: '新建导图', outline: DEFAULT_OUTLINE })
  mode.value = 'edit'
  resetInteraction()
  rebuildTree()
}

function closeEditor() {
  selectedId.value = null
}

function toggleMode() {
  if (mode.value === 'edit') {
    rebuildTree()
    mode.value = 'graph'
    nextTick(() => fitView())
  } else {
    commitTree()
    mode.value = 'edit'
  }
}

async function save() {
  if (!draft.title.trim()) {
    toast.error('标题不能为空')
    return
  }
  if (mode.value === 'graph') commitTree()
  const payload = { title: draft.title.trim(), outline: draft.outline }
  saving.value = true
  try {
    if (selectedId.value === 'new') {
      const created = await api.mindmaps.create(payload)
      items.value.unshift(created)
      selectedId.value = created.id
      toast.success('导图已创建')
    } else {
      const updated = await api.mindmaps.update(selectedId.value, payload)
      const idx = items.value.findIndex((m) => m.id === updated.id)
      if (idx >= 0) items.value[idx] = updated
      const [item] = items.value.splice(idx, 1)
      items.value.unshift(item)
      toast.success('导图已保存')
    }
    mode.value = 'graph'
    loadSummary()
    nextTick(() => fitView())
  } catch (err) {
    toast.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

async function doDelete() {
  const id = pendingDelete.value?.id ?? selectedId.value
  if (id == null) return
  try {
    await api.mindmaps.remove(id)
    items.value = items.value.filter((m) => m.id !== id)
    if (selectedId.value === id) selectedId.value = null
    toast.success('导图已删除')
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
    pendingDelete.value = null
  }
}

function askDeleteCurrent() {
  pendingDelete.value = null
  confirmOpen.value = true
}

// ---- 树编辑：内联改文字 / 增删节点 ----

function setEditInput(el) {
  if (el) editInputEl.value = el
}

function startEditNode(uid) {
  const node = nodeByUid(uid)
  if (!node) return
  selectedUid.value = uid
  editingUid.value = uid
  editingText.value = node.text
  nextTick(() => {
    editInputEl.value?.focus()
    editInputEl.value?.select()
  })
}

function commitEdit() {
  const uid = editingUid.value
  if (uid == null) return
  const node = nodeByUid(uid)
  if (node) node.text = editingText.value.trim() || '新节点'
  editingUid.value = null
  commitTree()
}

function cancelEdit() {
  editingUid.value = null
}

function onEditKeydown(e) {
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function addChild(uid) {
  const node = nodeByUid(uid)
  if (!node) return
  const child = { uid: newUid(), text: '新节点', children: [] }
  node.children.push(child)
  commitTree()
  nextTick(() => {
    startEditNode(child.uid)
    centerOnUid(child.uid)
  })
}

function addSibling(uid) {
  const found = findNode(tree.value, uid)
  if (!found || !found.parent) {
    addChild(uid)
    return
  }
  const index = found.parent.children.indexOf(found.node)
  const sibling = { uid: newUid(), text: '新节点', children: [] }
  found.parent.children.splice(index + 1, 0, sibling)
  commitTree()
  nextTick(() => {
    startEditNode(sibling.uid)
    centerOnUid(sibling.uid)
  })
}

function removeNode(uid) {
  const found = findNode(tree.value, uid)
  if (!found || !found.parent) return // 根节点不可删
  const index = found.parent.children.indexOf(found.node)
  if (index >= 0) found.parent.children.splice(index, 1)
  if (selectedUid.value === uid) selectedUid.value = null
  if (editingUid.value === uid) editingUid.value = null
  commitTree()
}

// ---- 节点操作菜单：右键 / 长按 ----

function openNodeMenu(node, x, y, fromTouch = false) {
  selectedUid.value = node.uid
  const menuItems = [
    { key: 'edit', label: '编辑文字', action: () => startEditNode(node.uid) },
    { key: 'child', label: '添加子节点', action: () => addChild(node.uid) },
  ]
  if (node.depth > 0) {
    menuItems.push({ key: 'sibling', label: '添加兄弟节点', action: () => addSibling(node.uid) })
    menuItems.push({ key: 'delete', label: '删除节点', danger: true, action: () => removeNode(node.uid) })
  }
  menu.open(menuItems, x, y, { title: node.text, fromTouch })
  cancelPan()
}

function onNodeCtx(node, e) {
  openNodeMenu(node, e.clientX, e.clientY)
}

function onPressStart(node, e) {
  if (e.touches.length > 1) return
  pressFired = false
  const touch = e.touches[0]
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressTimer = null
    pressFired = true
    try {
      navigator.vibrate?.(30)
    } catch (_) {}
    openNodeMenu(node, touch.clientX, touch.clientY, true)
  }, 550)
}

function onPressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function cancelPan() {
  pointers.clear()
  pan = null
  pinch = null
  panning.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

// ---- 导图卡片菜单：右键 / 长按 ----

function openCardMenu(map, x, y, fromTouch = false) {
  menu.open(
    [
      { key: 'open', label: '打开', action: () => openMap(map) },
      { key: 'delete', label: '删除', danger: true, action: () => askDeleteMap(map) },
    ],
    x,
    y,
    { width: 152, title: map.title, fromTouch },
  )
}

function onCardCtx(map, e) {
  openCardMenu(map, e.clientX, e.clientY)
}

function onCardPressStart(map, e) {
  if (e.touches.length > 1) return
  cardPressFired = false
  const touch = e.touches[0]
  clearTimeout(cardPressTimer)
  cardPressTimer = setTimeout(() => {
    cardPressTimer = null
    cardPressFired = true
    try {
      navigator.vibrate?.(30)
    } catch (_) {}
    openCardMenu(map, touch.clientX, touch.clientY, true)
  }, 550)
}

function onCardPressEnd() {
  if (cardPressTimer) {
    clearTimeout(cardPressTimer)
    cardPressTimer = null
  }
}

function onCardClick(map) {
  if (cardPressFired) {
    cardPressFired = false
    return
  }
  if (menu.state.visible) return
  openMap(map)
}

function askDeleteMap(map) {
  if (!map) return
  pendingDelete.value = map
  confirmOpen.value = true
}

// ---- 视图操作：自适应 / 缩放 / 平移 ----

function clampScale(value) {
  return Math.min(4, Math.max(0.2, value))
}

function fitView() {
  const el = canvasEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const l = layout.value
  const pad = 32
  const next = clampScale(
    Math.min((rect.width - pad * 2) / Math.max(l.width, 1), (rect.height - pad * 2) / Math.max(l.height, 1)),
  )
  scale.value = next
  tx.value = (rect.width - l.width * next) / 2
  ty.value = (rect.height - l.height * next) / 2
}

function setScaleAt(px, py, factor) {
  const from = scale.value
  const to = clampScale(from * factor)
  if (to === from) return
  tx.value = px - (px - tx.value) * (to / from)
  ty.value = py - (py - ty.value) * (to / from)
  scale.value = to
}

function zoomBy(factor) {
  const el = canvasEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  setScaleAt(rect.width / 2, rect.height / 2, factor)
}

function resetZoom() {
  const el = canvasEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  scale.value = 1
  tx.value = (rect.width - layout.value.width) / 2
  ty.value = (rect.height - layout.value.height) / 2
}

function onWheel(e) {
  const el = canvasEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  setScaleAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12)
}

function toggleLayout() {
  layoutMode.value = layoutMode.value === 'radial' ? 'tree' : 'radial'
  nextTick(() => fitView())
}

// ---- 拖拽平移 / 双指缩放 ----

const pointers = new Map()
let pan = null
let pinch = null
let didPan = false

function onPointerDown(e) {
  if (mode.value !== 'graph') return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const pts = [...pointers.values()]
  if (pts.length === 1) {
    panning.value = true
    pan = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
    pinch = null
    didPan = false
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  } else if (pts.length === 2) {
    pan = null
    const rect = canvasEl.value?.getBoundingClientRect() || { left: 0, top: 0 }
    pinch = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      scale: scale.value,
      cx: (pts[0].x + pts[1].x) / 2 - rect.left,
      cy: (pts[0].y + pts[1].y) / 2 - rect.top,
    }
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const pts = [...pointers.values()]
  if (pinch && pts.length >= 2) {
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    if (pinch.dist > 0) setScaleAt(pinch.cx, pinch.cy, (pinch.scale * (dist / pinch.dist)) / scale.value)
    didPan = true
  } else if (pan) {
    const dx = e.clientX - pan.x
    const dy = e.clientY - pan.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan = true
    tx.value = pan.tx + dx
    ty.value = pan.ty + dy
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size === 0) {
    pan = null
    panning.value = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }
}

function onNodeClick(node) {
  if (pressFired) {
    // 长按后松手会补一次 click，忽略它以免取消菜单选中。
    pressFired = false
    return
  }
  if (didPan) return
  if (editingUid.value != null) return
  if (menu.state.visible) return
  selectedUid.value = selectedUid.value === node.uid ? null : node.uid
}

// ---- 搜索定位 ----

function centerOnUid(uid) {
  const el = canvasEl.value
  const node = layout.value.nodes.find((n) => n.uid === uid)
  if (!el || !node) return
  const rect = el.getBoundingClientRect()
  tx.value = rect.width / 2 - (node.x + node.width / 2) * scale.value
  ty.value = rect.height / 2 - (node.y + node.height / 2) * scale.value
}

function nextMatch(dir) {
  if (!matches.value.length) return
  matchCursor.value = (matchCursor.value + dir + matches.value.length) % matches.value.length
  centerOnUid(matches.value[matchCursor.value])
}

watch(query, () => {
  matchCursor.value = 0
  if (matches.value.length) nextTick(() => centerOnUid(matches.value[0]))
})

// ---- 导出 ----

function safeName() {
  return (draft.title || 'mindmap').replace(/[\\/:*?"<>|]/g, '_').trim() || 'mindmap'
}

async function onExportPng() {
  try {
    await exportPng(layout.value, `${safeName()}.png`)
  } catch {
    toast.error('导出 PNG 失败')
  }
}

function onExportSvg() {
  try {
    exportSvg(layout.value, `${safeName()}.svg`)
  } catch {
    toast.error('导出 SVG 失败')
  }
}

// ---- 节点样式 ----

function nodeFrame(node) {
  return { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }
}

function nodeVisual(node) {
  const tone = toneForDepth(node.depth)
  return {
    backgroundColor: tone.fill,
    borderColor: tone.border,
    color: tone.text,
    boxShadow: node.depth === 0 ? '0 8px 20px -8px rgba(99,102,241,0.7)' : '0 2px 6px rgba(0,0,0,0.35)',
  }
}

function nodeClass(node) {
  const dim = activeIndex.value >= 0 && !pathIndices.value.has(node.id)
  return [
    dim ? 'opacity-25' : 'opacity-100',
    editingUid.value === node.uid ? 'ring-2 ring-rose-300/90' : '',
    activeUid.value === node.uid ? 'ring-2 ring-white/80' : '',
    matchSet.value.has(node.uid) ? 'ring-2 ring-amber-300/90' : '',
  ]
}

function edgeStroke(edge) {
  const onPath = activeIndex.value >= 0 && pathEdges.value.has(edge.child)
  if (activeIndex.value >= 0 && !onPath) return 'rgba(148,163,184,0.12)'
  return edge.branch >= 0 ? branchColor(edge.branch) : 'rgba(148,163,184,0.6)'
}

function edgeWidth(edge) {
  return activeIndex.value >= 0 && pathEdges.value.has(edge.child) ? 2.2 : 1.5
}

// ---- 快捷键（选中节点后：Tab 加子节点 / Enter 编辑 / Delete 删除） ----

function onGlobalKeydown(e) {
  if (menu.state.visible) return
  if (mode.value !== 'graph' || editingUid.value != null || selectedId.value == null) return
  const tag = document.activeElement?.tagName
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
  const uid = selectedUid.value
  if (uid == null) return
  if (e.key === 'Tab') {
    e.preventDefault()
    addChild(uid)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    startEditNode(uid)
  } else if (e.key === 'F2') {
    e.preventDefault()
    startEditNode(uid)
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    removeNode(uid)
  }
}

// ---- 生命周期 ----

let observer = null
watch(canvasEl, (el) => {
  observer?.disconnect()
  if (!el) return
  observer = new ResizeObserver(() => {
    if (mode.value === 'graph') fitView()
  })
  observer.observe(el)
  nextTick(() => fitView())
})

onMounted(() => {
  pageMenu.setMenu([
    { key: 'new', label: '新建导图', action: startNew },
    { key: 'refresh', label: '刷新', action: load },
  ], '思维导图')
  load()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- ===== 卡片画廊 ===== -->
    <template v-if="selectedId == null">
      <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-3">
        <div class="flex items-center gap-1.5 mr-auto">
          <Icon name="mindmap" :size="15" class="text-rose-400" />
          <span class="text-sm font-semibold text-slate-100">思维导图</span>
          <span class="text-[10px] font-mono text-slate-500">{{ items.length }}</span>
        </div>
        <div class="relative">
          <Icon name="search" :size="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            v-model="search"
            class="w-36 sm:w-52 pl-8 pr-2.5 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-400 transition"
            placeholder="搜索导图"
          />
        </div>
        <button
          class="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-mono border border-rose-400/30 transition"
          @click="startNew"
        >
          <Icon name="plus" :size="14" /> 新建
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
        <div v-if="loading" class="h-full min-h-[8rem] flex items-center justify-center text-slate-500 font-mono text-xs">加载中…</div>
        <EmptyState v-else-if="visible.length === 0" icon="mindmap" title="暂无导图" description="点击「新建」用缩进大纲创建。" />
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-1">
          <button
            v-for="map in visible"
            :key="map.id"
            class="group flex flex-col text-left rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 hover:border-rose-400/40 hover:bg-slate-900/80 transition overflow-hidden"
            @click="onCardClick(map)"
            @contextmenu.prevent="onCardCtx(map, $event)"
            @touchstart.passive="onCardPressStart(map, $event)"
            @touchmove="onCardPressEnd"
            @touchend="onCardPressEnd"
            @touchcancel="onCardPressEnd"
          >
            <div class="h-24 bg-slate-950/50 border-b border-white/5 p-2 overflow-hidden">
              <svg
                v-if="thumbs[map.id]"
                :viewBox="`0 0 ${thumbs[map.id].width} ${thumbs[map.id].height}`"
                preserveAspectRatio="xMidYMid meet"
                class="w-full h-full"
              >
                <path
                  v-for="(edge, i) in thumbs[map.id].edges"
                  :key="`e${i}`"
                  :d="edge.d"
                  fill="none"
                  :stroke="branchColor(edge.branch)"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
                <rect
                  v-for="node in thumbs[map.id].nodes"
                  :key="`n${node.id}`"
                  :x="node.x"
                  :y="node.y"
                  :width="node.width"
                  :height="node.height"
                  rx="6"
                  :fill="toneForDepth(node.depth).fill"
                  :stroke="toneForDepth(node.depth).border"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
            </div>
            <div class="p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-slate-100 truncate">{{ map.title }}</span>
                <span class="text-[9px] text-slate-500 font-mono shrink-0">{{ relativeTime(map.updated_at) }}</span>
              </div>
              <p class="text-[10px] text-slate-400 mt-1 line-clamp-2">{{ excerpt(map.outline) || '（空大纲）' }}</p>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- ===== 全屏详情 ===== -->
    <template v-else>
      <div class="flex-shrink-0 flex items-center gap-2 mb-2">
        <button
          class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition"
          title="返回列表"
          @click="closeEditor"
        >
          <Icon name="chevronLeft" :size="15" />
        </button>
        <input
          v-model="draft.title"
          :class="inputClass"
          class="flex-1 !text-sm font-semibold"
          placeholder="导图标题"
        />

        <button
          class="p-1.5 rounded-xl border transition"
          :class="mode === 'edit' ? 'bg-rose-600/80 text-white border-rose-400/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'"
          :title="mode === 'edit' ? '查看导图' : '文本大纲'"
          @click="toggleMode"
        >
          <Icon :name="mode === 'edit' ? 'mindmap' : 'edit'" :size="15" />
        </button>

        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 disabled:opacity-60 text-white text-xs font-mono border border-rose-400/30 transition"
          :disabled="saving"
          @click="save"
        >
          <Icon name="check" :size="14" /> 保存
        </button>

        <button
          v-if="selectedId !== 'new'"
          class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-rose-400 transition"
          title="删除"
          @click="askDeleteCurrent"
        >
          <Icon name="trash" :size="15" />
        </button>
      </div>

      <!-- 编辑：大纲文本 -->
      <textarea
        v-if="mode === 'edit'"
        v-model="draft.outline"
        class="flex-1 min-h-0 w-full resize-none rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 p-3.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-rose-400/40 selectable"
        placeholder="每行一个节点，用缩进表示层级：&#10;中心主题&#10;  分支一&#10;    叶子&#10;  分支二"
      />

      <!-- 预览 / 内联编辑：可平移缩放的导图画布 -->
      <div
        v-else
        ref="canvasEl"
        class="flex-1 min-h-0 relative overflow-hidden rounded-2xl bg-slate-900/45 backdrop-blur-md border border-white/10 select-none"
        :class="panning ? 'cursor-grabbing' : 'cursor-grab'"
        :style="canvasStyle"
        @pointerdown="onPointerDown"
        @wheel.prevent="onWheel"
      >
        <!-- 变换层：平移 + 缩放 -->
        <div class="absolute top-0 left-0" :style="transformStyle">
          <svg
            :width="layout.width"
            :height="layout.height"
            class="absolute inset-0 pointer-events-none"
            :viewBox="`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`"
          >
            <path
              v-for="(edge, i) in layout.edges"
              :key="i"
              :d="edge.d"
              fill="none"
              :stroke="edgeStroke(edge)"
              :stroke-width="edgeWidth(edge)"
              stroke-linecap="round"
            />
          </svg>

          <div
            v-for="node in layout.nodes"
            :key="node.uid"
            class="absolute"
            :style="nodeFrame(node)"
            @mouseenter="hoverUid = node.uid"
            @mouseleave="hoverUid = null"
          >
            <div
              class="absolute inset-0 flex flex-col items-center justify-center rounded-xl border text-center shadow-md transition-all duration-150"
              :class="nodeClass(node)"
              :style="nodeVisual(node)"
              :title="node.text"
              @click.stop="onNodeClick(node)"
              @dblclick.stop="startEditNode(node.uid)"
              @contextmenu.prevent.stop="onNodeCtx(node, $event)"
              @touchstart.passive="onPressStart(node, $event)"
              @touchend="onPressEnd"
              @touchcancel="onPressEnd"
            >
              <input
                v-if="editingUid === node.uid"
                :ref="setEditInput"
                v-model="editingText"
                class="w-full bg-transparent px-1 text-center focus:outline-none"
                :style="{ fontSize: '11px' }"
                @keydown="onEditKeydown"
                @blur="commitEdit"
                @pointerdown.stop
                @click.stop
              />
              <template v-else>
                <span
                  v-for="(line, i) in node.lines"
                  :key="i"
                  class="block px-1 whitespace-nowrap"
                  :style="{ fontSize: '11px', lineHeight: `${layout.lineHeight}px` }"
                >{{ line }}</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 搜索（左上浮层） -->
        <div
          class="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-xl bg-slate-950/75 backdrop-blur-md border border-white/10 shadow-lg"
          @pointerdown.stop
          @wheel.stop
        >
          <Icon name="search" :size="13" class="text-slate-400" />
          <input
            v-model="query"
            class="w-24 sm:w-32 bg-transparent text-[11px] text-white placeholder-slate-500 focus:outline-none selectable"
            placeholder="搜索节点"
          />
          <template v-if="query">
            <span class="text-[10px] font-mono text-slate-400">{{ matches.length ? matchCursor + 1 : 0 }}/{{ matches.length }}</span>
            <button class="p-0.5 text-slate-400 hover:text-white transition" title="上一个" @click="nextMatch(-1)">
              <Icon name="chevronUp" :size="13" />
            </button>
            <button class="p-0.5 text-slate-400 hover:text-white transition" title="下一个" @click="nextMatch(1)">
              <Icon name="chevronDown" :size="13" />
            </button>
            <button class="p-0.5 text-slate-400 hover:text-white transition" title="清除" @click="query = ''">
              <Icon name="close" :size="13" />
            </button>
          </template>
        </div>

        <!-- 控制（右下浮层） -->
        <div class="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1.5" @pointerdown.stop @wheel.stop>
          <div class="flex items-center gap-0.5 bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl px-1 py-0.5 shadow-lg text-slate-300">
            <button class="p-1.5 rounded-lg hover:bg-white/10 transition" title="适应窗口" @click="fitView">
              <Icon name="target" :size="14" />
            </button>
            <span class="w-px h-4 bg-white/10 mx-0.5" />
            <button class="p-1.5 rounded-lg hover:bg-white/10 transition" title="缩小" @click="zoomBy(1 / 1.2)">
              <Icon name="minus" :size="13" />
            </button>
            <button
              class="w-9 text-[10px] font-mono text-slate-400 hover:text-white transition text-center"
              title="重置为 100%"
              @click="resetZoom"
            >
              {{ Math.round(scale * 100) }}%
            </button>
            <button class="p-1.5 rounded-lg hover:bg-white/10 transition" title="放大" @click="zoomBy(1.2)">
              <Icon name="plus" :size="13" />
            </button>
            <span class="w-px h-4 bg-white/10 mx-0.5" />
            <button
              class="p-1.5 rounded-lg hover:bg-white/10 transition"
              :class="layoutMode === 'radial' ? 'text-rose-400' : ''"
              :title="layoutMode === 'radial' ? '切换为水平树' : '切换为径向'"
              @click="toggleLayout"
            >
              <Icon :name="layoutMode === 'radial' ? 'gitBranch' : 'share'" :size="14" />
            </button>
          </div>

          <div class="flex items-center gap-0.5 bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl px-1 py-0.5 shadow-lg text-slate-300">
            <button class="p-1.5 rounded-lg hover:bg-white/10 transition" title="导出 PNG" @click="onExportPng">
              <Icon name="image" :size="14" />
            </button>
            <button class="p-1.5 rounded-lg hover:bg-white/10 transition" title="导出 SVG" @click="onExportSvg">
              <Icon name="download" :size="14" />
            </button>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 flex items-center justify-between gap-2 mt-1.5">
        <span class="text-[10px] text-slate-500 font-mono">
          <template v-if="activeMap">{{ relativeTime(activeMap.updated_at) }} · 节点 {{ layout.nodes.length }} · {{ layoutMode === 'radial' ? '径向' : '水平树' }}</template>
          <template v-else>新导图</template>
        </span>
        <span class="hidden sm:block text-[10px] text-slate-600 font-mono">右键 / 长按节点操作 · 双击编辑 · Tab 子节点 · Enter 编辑 · Delete 删除</span>
      </div>
    </template>

    <!-- 节点 / 卡片操作菜单由全局 ContextMenu 统一渲染（右键 / 长按） -->

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除导图"
      :message="(pendingDelete?.title || draft.title) ? `确定删除「${pendingDelete?.title || draft.title}」吗？` : '确定删除这张导图吗？'"
      @confirm="doDelete"
    />
  </div>
</template>
