<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { gradientFor, initials, parseTags, tagColor } from '@/utils/format'

const toast = useToast()

const items = ref([])
const loading = ref(true)
const search = ref('')
const activeTag = ref('ALL')
const searchEl = ref(null)
const searchOpen = ref(false)

const modalOpen = ref(false)
const editing = ref(null)
const form = reactive({ title: '', url: '', description: '', tags: '' })
const tagInput = ref('')

const confirmOpen = ref(false)
const pendingDelete = ref(null)

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-400 transition'

const allTags = computed(() => {
  const set = new Set()
  items.value.forEach((b) => (b.tags || []).forEach((t) => set.add(t)))
  return [...set]
})

const untaggedCount = computed(() => items.value.filter((b) => !(b.tags || []).length).length)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((b) => {
    const tags = b.tags || []
    const matchTag =
      activeTag.value === 'ALL' ||
      (activeTag.value === '__untagged__' ? tags.length === 0 : tags.includes(activeTag.value))
    if (!matchTag) return false
    if (!q) return true
    return [b.title, b.description, b.url, ...tags]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(q))
  }).sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0))
})

// 渲染模型：全部 + 无搜索时按首个标签分组，否则平铺；index 用于快捷键提示。
const renderModel = computed(() => {
  const grouped = activeTag.value === 'ALL' && !search.value.trim()
  if (grouped) {
    const map = new Map()
    filtered.value.forEach((b) => {
      const key = (b.tags || [])[0] || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(b)
    })
    let counter = 0
    const groups = [...map.entries()].map(([tag, list]) => ({
      tag: tag || '未分类',
      items: list.map((b) => ({ b, index: (counter += 1) })),
    }))
    return { grouped: true, groups, order: groups.flatMap((g) => g.items.map((it) => it.b)) }
  }
  const list = filtered.value.map((b, index) => ({ b, index: index + 1 }))
  return { grouped: false, list, order: filtered.value }
})

async function load() {
  loading.value = true
  try {
    items.value = await api.bookmarks.list()
  } catch (err) {
    toast.error(`书签加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function setTag(tag) {
  activeTag.value = tag
}

function addTag() {
  const t = tagInput.value.trim()
  if (!t) return
  const current = parseTags(form.tags)
  if (!current.includes(t)) current.push(t)
  form.tags = current.join(', ')
  tagInput.value = ''
}

function removeTag(t) {
  const current = parseTags(form.tags).filter((x) => x !== t)
  form.tags = current.join(', ')
}

function onTagKey(e) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault()
    addTag()
  }
  if (e.key === 'Backspace' && !tagInput.value.trim() && parseTags(form.tags).length > 0) {
    const arr = parseTags(form.tags)
    arr.pop()
    form.tags = arr.join(', ')
  }
}

function openAdd() {
  editing.value = null
  Object.assign(form, { title: '', url: '', description: '', tags: activeTag.value.startsWith('__') ? '' : activeTag.value === 'ALL' ? '' : activeTag.value })
  modalOpen.value = true
}

function openEdit(bookmark) {
  editing.value = bookmark
  Object.assign(form, {
    title: bookmark.title,
    url: bookmark.url,
    description: bookmark.description || '',
    tags: (bookmark.tags || []).join(', '),
  })
  modalOpen.value = true
}

async function save() {
  if (!form.title.trim() || !form.url.trim()) {
    toast.error('名称与链接为必填项')
    return
  }
  const payload = {
    title: form.title.trim(),
    url: form.url.trim(),
    description: form.description.trim(),
    tags: parseTags(form.tags),
  }
  try {
    if (editing.value) {
      const updated = await api.bookmarks.update(editing.value.id, payload)
      const idx = items.value.findIndex((b) => b.id === updated.id)
      if (idx >= 0) items.value[idx] = updated
      toast.success('书签已更新')
    } else {
      const created = await api.bookmarks.create(payload)
      items.value.push(created)
      toast.success('书签已添加')
    }
    modalOpen.value = false
    loadSummary()
  } catch (err) {
    toast.error(`保存失败：${err.message}`)
  }
}

function askDelete(bookmark) {
  pendingDelete.value = bookmark
  confirmOpen.value = true
}

async function doDelete() {
  if (!pendingDelete.value) return
  const target = pendingDelete.value
  try {
    await api.bookmarks.remove(target.id)
    items.value = items.value.filter((b) => b.id !== target.id)
    toast.success('书签已删除')
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
    pendingDelete.value = null
  }
}

function onOpen(bookmark) {
  // 访问计数：不阻塞跳转，失败也不提示。
  if (bookmark.id != null) {
    api.bookmarks
      .visit(bookmark.id)
      .then((updated) => {
        bookmark.visit_count = updated.visit_count
      })
      .catch(() => {})
  }
}

// 卡片操作菜单：右键 / 长按调起，默认不显示编辑删除按钮。
const ctxMenu = ref(null) // { x, y, bookmark }
let pressTimer = null
let pressFired = false

function openCardMenu(bookmark, x, y) {
  const w = 160
  const h = 132
  const pad = 8
  ctxMenu.value = {
    bookmark,
    x: Math.max(pad, Math.min(x ?? 0, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y ?? 0, window.innerHeight - h - pad)),
  }
  window.addEventListener('scroll', closeCardMenu, { capture: true, once: true })
}

function closeCardMenu() {
  ctxMenu.value = null
  pressFired = false
}

function onCardCtx(bookmark, e) {
  openCardMenu(bookmark, e.clientX, e.clientY)
}

function onPressStart(bookmark, e) {
  if (e.touches.length > 1) return
  pressFired = false
  const t = e.touches[0]
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressTimer = null
    pressFired = true
    try {
      navigator.vibrate?.(30)
    } catch (_) {}
    openCardMenu(bookmark, t.clientX, t.clientY)
  }, 550)
}

function onPressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function guardCardClick(e) {
  // 长按后松手会触发一次 click，用它阻止链接跳转。
  if (pressFired) {
    e.preventDefault()
    e.stopImmediatePropagation()
    pressFired = false
  }
}

function ctxEdit() {
  const b = ctxMenu.value?.bookmark
  closeCardMenu()
  if (b) openEdit(b)
}

function ctxCopy() {
  const b = ctxMenu.value?.bookmark
  closeCardMenu()
  if (!b?.url) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(b.url).then(
      () => toast.success('链接已复制'),
      () => toast.error('复制失败'),
    )
  } else {
    toast.error('当前环境不支持复制')
  }
}

function ctxDelete() {
  const b = ctxMenu.value?.bookmark
  closeCardMenu()
  if (b) askDelete(b)
}

function openFirst() {
  const first = renderModel.value.order[0]
  if (first) window.open(first.url, '_blank', 'noopener')
}

function focusSearch() {
  searchOpen.value = true
  nextTick(() => searchEl.value?.focus())
}

function closeSearch() {
  search.value = ''
  searchOpen.value = false
}

function toggleSearch() {
  if (searchOpen.value) closeSearch()
  else focusSearch()
}

function onGlobalKeydown(e) {
  if (e.key === 'Escape' && ctxMenu.value) {
    closeCardMenu()
    return
  }
  const tag = document.activeElement?.tagName
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    focusSearch()
  } else if (!typing && e.key >= '1' && e.key <= '9' && !modalOpen.value) {
    const target = renderModel.value.order[Number(e.key) - 1]
    if (target) window.open(target.url, '_blank', 'noopener')
  }
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onGlobalKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 工具条：标签 + 搜索 + 新建同一行 -->
    <div class="flex-shrink-0 flex items-center gap-2 mb-2">
      <!-- 标签过滤 -->
      <div class="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-mono">
        <button
          class="px-3 py-1 rounded-xl whitespace-nowrap border transition-all"
          :class="
            activeTag === 'ALL'
              ? 'bg-indigo-600 text-white border-indigo-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'
          "
          @click="setTag('ALL')"
        >
          全部书签
        </button>
        <button
          v-for="tag in allTags"
          :key="tag"
          class="px-3 py-1 rounded-xl whitespace-nowrap border transition-all"
          :class="
            activeTag === tag
              ? 'bg-indigo-600 text-white border-indigo-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'
          "
          @click="setTag(tag)"
        >
          {{ tag }}
        </button>
        <button
          v-if="untaggedCount"
          class="px-3 py-1 rounded-xl whitespace-nowrap border transition-all"
          :class="
            activeTag === '__untagged__'
              ? 'bg-indigo-600 text-white border-indigo-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'
          "
          @click="setTag('__untagged__')"
        >
          未分类
        </button>
      </div>

      <div class="flex items-center gap-1.5 flex-shrink-0">
        <button
          class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition"
          title="搜索（/）"
          @click="toggleSearch"
        >
          <Icon name="search" :size="14" />
        </button>
        <div v-if="searchOpen" class="relative min-w-[100px] max-w-[200px]">
          <input
            ref="searchEl"
            v-model="search"
            type="text"
            placeholder="搜索"
            class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-indigo-400 rounded-lg text-xs text-white placeholder-slate-500 backdrop-blur-md focus:outline-none transition"
            @keydown.enter="openFirst"
            @keydown.esc="closeSearch"
          />
        </div>
      </div>

      <button
        class="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-600 active:bg-indigo-700 text-white text-xs font-mono transition border border-indigo-400/30 shadow-lg shadow-indigo-500/10"
        @click="openAdd"
      >
        <Icon name="plus" :size="14" />
        <span class="hidden xs:inline">添加书签</span>
      </button>
    </div>

    <!-- 主体 -->
    <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
      <div v-if="loading" class="h-full min-h-[12rem] flex items-center justify-center text-slate-500 font-mono text-xs">
        正在加载书签…
      </div>

      <EmptyState
        v-else-if="filtered.length === 0"
        icon="search"
        title="没有找到匹配的书签"
        description="试试更换筛选条件，或按 Esc 清空搜索。"
      />

      <div v-else-if="renderModel.grouped" class="space-y-3.5">
        <div v-for="group in renderModel.groups" :key="group.tag" class="space-y-2">
          <div class="flex items-center gap-2 text-xs font-mono font-medium text-slate-400">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>{{ group.tag }}</span>
            <span class="text-[10px] text-slate-600">({{ group.items.length }})</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
            <a
              v-for="entry in group.items"
              :key="entry.b.id"
              :href="entry.b.url"
              target="_blank"
              rel="noopener noreferrer"
              class="group/item relative flex items-center gap-2.5 p-2.5 rounded-2xl bg-slate-900/55 hover:bg-slate-900/80 backdrop-blur-md border border-white/10 hover:border-indigo-400/40 shadow-lg hover:shadow-indigo-500/10 transition-all duration-200 overflow-hidden"
              @click="onOpen(entry.b)"
              @click.capture="guardCardClick"
              @contextmenu.prevent="onCardCtx(entry.b, $event)"
              @touchstart.passive="onPressStart(entry.b, $event)"
              @touchmove="onPressEnd"
              @touchend="onPressEnd"
              @touchcancel="onPressEnd"
            >
              <div
                class="w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-mono text-xs font-bold shadow-md shadow-black/40 flex-shrink-0 group-hover/item:scale-105 transition-transform"
                :class="gradientFor(entry.b.title)"
              >
                {{ initials(entry.b.title) }}
              </div>

              <div class="overflow-hidden flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-semibold text-slate-200 group-hover/item:text-white truncate transition leading-tight">
                    {{ entry.b.title }}
                  </span>
                </div>
                <div class="text-[10px] text-slate-400 truncate mt-0.5">{{ entry.b.description || entry.b.url }}</div>
                <div v-if="(entry.b.tags || []).length" class="flex items-center gap-1 mt-1 overflow-hidden">
                  <span
                    v-for="t in entry.b.tags.slice(0, 3)"
                    :key="t"
                    class="text-[9px] px-1.5 py-px rounded-md border whitespace-nowrap"
                    :class="tagColor(t)"
                  >
                    {{ t }}
                  </span>
                </div>
              </div>
            </a>
          </div>
        </div>
      </div>

      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
        <a
          v-for="entry in renderModel.list"
          :key="entry.b.id"
          :href="entry.b.url"
          target="_blank"
          rel="noopener noreferrer"
              class="group/item relative flex items-center gap-2.5 p-2.5 rounded-2xl bg-slate-900/55 hover:bg-slate-900/80 backdrop-blur-md border border-white/10 hover:border-indigo-400/40 shadow-lg hover:shadow-indigo-500/10 transition-all duration-200 overflow-hidden"
              @click="onOpen(entry.b)"
              @click.capture="guardCardClick"
              @contextmenu.prevent="onCardCtx(entry.b, $event)"
              @touchstart.passive="onPressStart(entry.b, $event)"
              @touchmove="onPressEnd"
              @touchend="onPressEnd"
              @touchcancel="onPressEnd"
            >
          <div
            class="w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-mono text-xs font-bold shadow-md shadow-black/40 flex-shrink-0 group-hover/item:scale-105 transition-transform"
            :class="gradientFor(entry.b.title)"
          >
            {{ initials(entry.b.title) }}
          </div>

          <div class="overflow-hidden flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-semibold text-slate-200 group-hover/item:text-white truncate transition leading-tight">
                  {{ entry.b.title }}
                  </span>
                </div>
            <div class="text-[10px] text-slate-400 truncate mt-0.5">{{ entry.b.description || entry.b.url }}</div>
            <div v-if="(entry.b.tags || []).length" class="flex items-center gap-1 mt-1 overflow-hidden">
              <span
                v-for="t in entry.b.tags.slice(0, 3)"
                :key="t"
                class="text-[9px] px-1.5 py-px rounded-md border whitespace-nowrap"
                :class="tagColor(t)"
              >
                {{ t }}
              </span>
            </div>
          </div>
        </a>
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <ModalShell
      v-model="modalOpen"
      :title="editing ? '编辑书签' : '添加新书签'"
      icon="bookmark"
      max-width="max-w-sm"
    >
      <div class="space-y-2.5 text-xs">
        <div>
          <label class="block text-slate-400 mb-1">网站名称</label>
          <input v-model="form.title" :class="inputClass" placeholder="例如: GitHub" @keydown.enter="save" />
        </div>
        <div>
          <label class="block text-slate-400 mb-1">链接 URL</label>
          <input v-model="form.url" :class="inputClass" placeholder="https://..." @keydown.enter="save" />
        </div>
        <div>
          <label class="block text-slate-400 mb-1">描述 / 备注</label>
          <input v-model="form.description" :class="inputClass" placeholder="代码仓库与自动化..." @keydown.enter="save" />
        </div>
        <div>
          <label class="block text-slate-400 mb-1">标签</label>
          <div class="flex flex-wrap gap-1.5 items-center bg-slate-950 border border-white/10 rounded-xl px-2 py-1.5 focus-within:border-indigo-400 transition">
            <template v-for="tag in parseTags(form.tags)" :key="tag">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-200 text-[10px] font-medium border border-indigo-400/30">
                {{ tag }}
                <button type="button" class="hover:text-white" @click="removeTag(tag)">×</button>
              </span>
            </template>
            <input v-model="tagInput" :class="'bg-transparent outline-none text-white text-xs placeholder-slate-500 w-20 flex-1 min-w-[3rem]'" placeholder="输入标签后回车" @keydown="onTagKey" />
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2 text-xs font-mono">
          <button class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" @click="modalOpen = false">
            取消
          </button>
          <button
            class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition shadow-lg shadow-indigo-500/20"
            @click="save"
          >
            {{ editing ? '保存修改' : '保存书签' }}
          </button>
        </div>
      </template>
    </ModalShell>

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除书签"
      :message="pendingDelete ? `确定删除「${pendingDelete.title}」吗？` : ''"
      @confirm="doDelete"
    />

    <!-- 卡片操作菜单：右键 / 长按调起；Teleport 到 body 避免祖先 transform 影响 fixed 定位 -->
    <Teleport to="body">
      <div v-if="ctxMenu" class="fixed inset-0 z-40" @click="closeCardMenu" @contextmenu.prevent="closeCardMenu" />
      <div
        v-if="ctxMenu"
        class="fixed z-50 w-[152px] rounded-xl bg-slate-900 border border-white/15 shadow-xl shadow-black/50 p-1 text-xs"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/10 transition" @click="ctxEdit">
          编辑
        </button>
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/10 transition" @click="ctxCopy">
          复制链接
        </button>
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition" @click="ctxDelete">
          删除
        </button>
      </div>
    </Teleport>
  </div>
</template>
