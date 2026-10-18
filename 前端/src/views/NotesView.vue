<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import TagFilterBar from '@/components/TagFilterBar.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { useContextMenu } from '@/composables/useContextMenu'
import { usePageMenu } from '@/composables/usePageMenu'
import { parseTags, relativeTime, tagColor } from '@/utils/format'
import { renderMarkdown } from '@/utils/markdown'

const toast = useToast()
const menu = useContextMenu()
const pageMenu = usePageMenu()

const notes = ref([])
const loading = ref(true)
const search = ref('')
const searchOpen = ref(false)
const activeTag = ref('ALL')
const searchEl = ref(null)

const selectedId = ref(null) // number | 'new' | null
const draft = reactive({ title: '', content: '', tags: '' })
const tagInput = ref('')
const preview = ref(false)
const saving = ref(false)

const confirmOpen = ref(false)
const pendingDelete = ref(null)

// 笔记操作菜单：右键 / 长按调起全局菜单。
let pressTimer = null
let pressFired = false

const allTags = computed(() => {
  const set = new Set()
  notes.value.forEach((n) => (n.tags || []).forEach((t) => set.add(t)))
  return [...set]
})

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return notes.value.filter((n) => {
    const tags = n.tags || []
    if (activeTag.value !== 'ALL' && !tags.includes(activeTag.value)) return false
    if (!q) return true
    return [n.title, n.content, ...tags].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
  })
})

const renderedHtml = computed(() => renderMarkdown(draft.content))
const draftTagList = computed(() => parseTags(draft.tags))

function excerpt(content) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
}

async function load() {
  loading.value = true
  try {
    notes.value = await api.notes.list()
  } catch (err) {
    toast.error(`笔记加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function openNote(note) {
  selectedId.value = note.id
  Object.assign(draft, { title: note.title, content: note.content || '', tags: (note.tags || []).join(', ') })
  preview.value = false
  tagInput.value = ''
}

function startNew() {
  selectedId.value = 'new'
  Object.assign(draft, { title: '', content: '', tags: activeTag.value === 'ALL' ? '' : activeTag.value })
  preview.value = false
  tagInput.value = ''
}

function addTag() {
  const tag = tagInput.value.trim()
  if (!tag) return
  const tags = parseTags(draft.tags)
  if (!tags.includes(tag)) tags.push(tag)
  draft.tags = tags.join(', ')
  tagInput.value = ''
}

function removeTag(tag) {
  draft.tags = parseTags(draft.tags).filter((item) => item !== tag).join(', ')
}

function onTagKey(event) {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    addTag()
  }
  if (event.key === 'Backspace' && !tagInput.value.trim() && draftTagList.value.length) {
    const tags = draftTagList.value.slice(0, -1)
    draft.tags = tags.join(', ')
  }
}

function closeEditor() {
  selectedId.value = null
}

async function save() {
  if (!draft.title.trim()) {
    toast.error('标题不能为空')
    return
  }
  addTag() // 提交尚未回车、还留在输入框里的标签
  const payload = { title: draft.title.trim(), content: draft.content, tags: parseTags(draft.tags) }
  saving.value = true
  try {
    if (selectedId.value === 'new') {
      const created = await api.notes.create(payload)
      notes.value.unshift(created)
      selectedId.value = created.id
      toast.success('笔记已创建')
    } else {
      const updated = await api.notes.update(selectedId.value, payload)
      const idx = notes.value.findIndex((n) => n.id === updated.id)
      if (idx >= 0) notes.value[idx] = updated
      // 让最近编辑的排到最前
      const [item] = notes.value.splice(idx, 1)
      notes.value.unshift(item)
      toast.success('笔记已保存')
    }
    loadSummary()
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
    await api.notes.remove(id)
    notes.value = notes.value.filter((n) => n.id !== id)
    if (selectedId.value === id) selectedId.value = null
    toast.success('笔记已删除')
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
    pendingDelete.value = null
  }
}

// ---- 笔记操作菜单：右键 / 长按 ----

function openNoteMenu(note, x, y, fromTouch = false) {
  menu.open(
    [
      { key: 'open', label: '打开', action: () => openNote(note) },
      { key: 'delete', label: '删除', danger: true, action: () => askDeleteNote(note) },
    ],
    x,
    y,
    { width: 152, title: note.title, fromTouch },
  )
}

function onNoteCtx(note, e) {
  openNoteMenu(note, e.clientX, e.clientY)
}

function onNotePressStart(note, e) {
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
    openNoteMenu(note, touch.clientX, touch.clientY, true)
  }, 550)
}

function onNotePressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onNoteCardClick(note) {
  if (pressFired) {
    pressFired = false
    return
  }
  if (menu.state.visible) return
  openNote(note)
}

function askDeleteNote(note) {
  if (!note) return
  pendingDelete.value = note
  confirmOpen.value = true
}

function askDeleteFromDetail() {
  pendingDelete.value = { id: selectedId.value, title: draft.title }
  confirmOpen.value = true
}

const activeNote = computed(() => notes.value.find((n) => n.id === selectedId.value) || null)

function openSearch() {
  searchOpen.value = true
  nextTick(() => searchEl.value?.focus())
}

function closeSearch() {
  search.value = ''
  searchOpen.value = false
}

function toggleSearch() {
  if (searchOpen.value) closeSearch()
  else openSearch()
}

function onSearchKeydown(e) {
  const tag = document.activeElement?.tagName
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)
  if (typing) return
  if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    if (selectedId.value != null) return
    openSearch()
  }
}

onMounted(() => {
  pageMenu.setMenu([
    { key: 'new', label: '新建笔记', action: startNew },
    { key: 'refresh', label: '刷新', action: load },
  ], '笔记')
  load()
  window.addEventListener('keydown', onSearchKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onSearchKeydown))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- ===== 卡片画廊 ===== -->
    <template v-if="selectedId == null">
      <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-2">
        <div class="flex items-center gap-1.5 mr-auto">
          <Icon name="note" :size="15" class="text-violet-400" />
          <span class="text-sm font-semibold text-slate-100">笔记</span>
          <span class="text-[10px] font-mono text-slate-500">{{ visible.length }}</span>
        </div>
        <button
          class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition"
          title="搜索（/）"
          @click="toggleSearch"
        >
          <Icon name="search" :size="13" />
        </button>
        <div v-if="searchOpen" class="relative min-w-[100px] max-w-[180px]">
          <input
            ref="searchEl"
            v-model="search"
            type="text"
            placeholder="搜索"
            class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-violet-400 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none transition"
            @keydown.esc="closeSearch"
          />
        </div>
        <button
          class="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white text-xs font-mono border border-violet-400/30 transition"
          @click="startNew"
        >
          <Icon name="plus" :size="14" /> 新建
        </button>
      </div>

      <!-- 标签过滤：放不下的收进「更多 ▾」（与书签页同一个组件，样式一致） -->
      <TagFilterBar
        v-if="allTags.length"
        class="flex-shrink-0 mb-1"
        :tags="allTags"
        :active="activeTag"
        accent="violet"
        size="sm"
        @select="activeTag = $event"
      />

      <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
        <div v-if="loading" class="h-full min-h-[8rem] flex items-center justify-center text-slate-500 font-mono text-xs">加载中…</div>
        <EmptyState v-else-if="visible.length === 0" icon="note" title="暂无笔记" description="点击「新建」开始写。" />
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-1">
          <button
            v-for="note in visible"
            :key="note.id"
            class="group relative flex flex-col text-left rounded-2xl bg-slate-900/55 border border-white/10 hover:border-violet-400/40 hover:bg-slate-900/80 transition p-3 min-h-[7.5rem]"
            @click="onNoteCardClick(note)"
            @contextmenu.prevent="onNoteCtx(note, $event)"
            @touchstart.passive="onNotePressStart(note, $event)"
            @touchmove="onNotePressEnd"
            @touchend="onNotePressEnd"
            @touchcancel="onNotePressEnd"
          >
            <div class="flex items-center gap-2 pr-16">
              <span class="text-xs font-semibold text-slate-100 truncate">{{ note.title }}</span>
            </div>
            <span class="absolute top-3 right-3 text-[9px] text-slate-500 font-mono">{{ relativeTime(note.updated_at) }}</span>
            <p class="text-[10px] text-slate-400 mt-1.5 line-clamp-3 flex-1">{{ excerpt(note.content) || '（空笔记）' }}</p>
            <div v-if="(note.tags || []).length" class="flex items-center gap-1 mt-2 flex-wrap">
              <span
                v-for="t in note.tags.slice(0, 4)"
                :key="t"
                class="text-[9px] px-1.5 py-px rounded-md border"
                :class="tagColor(t)"
              >
                {{ t }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- ===== 全屏详情 / 新建 ===== -->
    <template v-else>
      <!-- 顶栏：返回 + 状态 + 操作 -->
      <div class="flex-shrink-0 flex items-center gap-2 mb-2.5">
        <button
          class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition"
          title="返回列表"
          @click="closeEditor"
        >
          <Icon name="chevronLeft" :size="15" />
        </button>

        <span class="text-[11px] font-mono text-slate-500 truncate">
          {{ selectedId === 'new' ? '新建笔记' : '编辑笔记' }}
        </span>

        <div class="flex-1" />

        <button
          class="p-1.5 rounded-xl border transition"
          :class="preview ? 'bg-violet-600/80 text-white border-violet-400/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'"
          :title="preview ? '编辑' : '预览'"
          @click="preview = !preview"
        >
          <Icon :name="preview ? 'edit' : 'note'" :size="15" />
        </button>
        <button
          v-if="selectedId !== 'new'"
          class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-rose-400 transition"
          title="删除"
          @click="askDeleteFromDetail"
        >
          <Icon name="trash" :size="15" />
        </button>
        <button
          class="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 disabled:opacity-60 text-white text-xs font-mono border border-violet-400/30 transition"
          :disabled="saving"
          @click="save"
        >
          <Icon name="check" :size="14" /> 保存
        </button>
      </div>

      <!-- 文档卡片：标题 / 标签 / 正文一体 -->
      <div class="flex-1 min-h-0 flex flex-col rounded-2xl bg-slate-900/55 border border-white/10 overflow-hidden">
        <input
          v-model="draft.title"
          class="w-full flex-shrink-0 bg-transparent px-4 sm:px-5 pt-4 pb-2 text-base sm:text-lg font-semibold text-white caret-violet-400 placeholder-slate-500 focus:outline-none selectable"
          placeholder="笔记标题"
        />

        <div class="flex-shrink-0 flex flex-wrap items-center gap-1.5 px-4 sm:px-5 pb-3">
          <Icon name="tag" :size="13" class="text-slate-500 shrink-0" />
          <template v-for="tag in draftTagList" :key="tag">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border" :class="tagColor(tag)">
              {{ tag }}
              <button type="button" class="hover:text-white" @click="removeTag(tag)">×</button>
            </span>
          </template>
          <input
            v-model="tagInput"
            class="flex-1 min-w-[5rem] bg-transparent text-[11px] text-slate-300 caret-violet-400 placeholder-slate-600 focus:outline-none selectable"
            :placeholder="draftTagList.length ? '' : '输入标签后回车或点空白处'"
            @keydown="onTagKey"
            @blur="addTag"
          />
        </div>

        <div class="flex-shrink-0 h-px bg-white/10" />

        <textarea
          v-if="!preview"
          v-model="draft.content"
          class="flex-1 w-full resize-none bg-transparent px-4 sm:px-5 py-4 text-xs text-slate-200 caret-violet-400 font-mono leading-relaxed focus:outline-none selectable custom-scroll"
          placeholder="支持 Markdown：# 标题、**粗体**、`代码`、- 列表、> 引用、``` 代码块 ```"
        />
        <div v-else class="md-preview flex-1 overflow-y-auto custom-scroll px-4 sm:px-5 py-4" v-html="renderedHtml" />
      </div>

      <!-- 底栏：时间 + 字数 -->
      <div class="flex-shrink-0 flex items-center justify-between gap-2 mt-2 px-1">
        <span class="text-[10px] text-slate-500 font-mono truncate">
          <template v-if="activeNote">最近编辑 {{ relativeTime(activeNote.updated_at) }} · 创建 {{ activeNote.created_at }}</template>
          <template v-else>新笔记</template>
        </span>
        <span class="text-[10px] text-slate-500 font-mono shrink-0">{{ draft.content.length }} 字</span>
      </div>
    </template>

    <!-- 笔记操作菜单由全局 ContextMenu 统一渲染（右键 / 长按） -->

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除笔记"
      :message="(pendingDelete?.title || draft.title) ? `确定删除「${pendingDelete?.title || draft.title}」吗？` : '确定删除这篇笔记吗？'"
      @confirm="doDelete"
    />
  </div>
</template>
