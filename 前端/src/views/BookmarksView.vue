<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import BookmarkTile from '@/components/BookmarkTile.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { useContextMenu } from '@/composables/useContextMenu'
import { usePageMenu } from '@/composables/usePageMenu'
import { parseTags } from '@/utils/format'

const toast = useToast()
const menu = useContextMenu()
const pageMenu = usePageMenu()

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

// 卡片操作菜单：右键 / 长按调起全局菜单（由 BookmarkTile 组件统一处理）。
function openCardMenu(bookmark, x, y, fromTouch = false) {
  menu.open(
    [
      { key: 'edit', label: '编辑', action: () => openEdit(bookmark) },
      { key: 'copy', label: '复制链接', action: () => copyLink(bookmark) },
      { key: 'delete', label: '删除', danger: true, action: () => askDelete(bookmark) },
    ],
    x,
    y,
    { width: 152, title: bookmark.title, fromTouch },
  )
}

function onCardCtx(bookmark, e) {
  const x = e?.clientX ?? 0
  const y = e?.clientY ?? 0
  openCardMenu(bookmark, x, y, !e?.clientX)
}


function copyLink(bookmark) {
  if (!bookmark?.url) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(bookmark.url).then(
      () => toast.success('链接已复制'),
      () => toast.error('复制失败'),
    )
  } else {
    toast.error('当前环境不支持复制')
  }
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
  pageMenu.setMenu([
    { key: 'new', label: '新建书签', action: openAdd },
    { key: 'refresh', label: '刷新', action: load },
  ], '书签')
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

      <div v-else-if="renderModel.grouped" class="space-y-3">
        <div v-for="group in renderModel.groups" :key="group.tag" class="space-y-1.5">
          <div class="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-400">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>{{ group.tag }}</span>
            <span class="text-[10px] text-slate-600">({{ group.items.length }})</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
            <BookmarkTile
              v-for="entry in group.items"
              :key="entry.b.id"
              :bookmark="entry.b"
              @open="onOpen"
              @ctx="onCardCtx"
            />
          </div>
        </div>
      </div>

      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
        <BookmarkTile
          v-for="entry in renderModel.list"
          :key="entry.b.id"
          :bookmark="entry.b"
          @open="onOpen"
          @ctx="onCardCtx"
        />
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

    <!-- 卡片操作菜单由全局 ContextMenu 统一渲染（右键 / 长按） -->
  </div>
</template>
