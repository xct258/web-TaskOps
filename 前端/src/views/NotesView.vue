<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { parseTags, relativeTime, tagColor } from '@/utils/format'
import { renderMarkdown } from '@/utils/markdown'

const toast = useToast()

const notes = ref([])
const loading = ref(true)
const search = ref('')
const activeTag = ref('ALL')
const searchEl = ref(null)

const selectedId = ref(null) // number | 'new' | null
const draft = reactive({ title: '', content: '', tags: '' })
const preview = ref(false)
const saving = ref(false)

const confirmOpen = ref(false)
const pendingDelete = ref(null)

// 笔记操作菜单：右键 / 长按调起（Teleport 到 body 避免祖先 transform 影响 fixed 定位）。
const ctxMenu = ref(null) // { x, y, note }
let pressTimer = null
let pressFired = false

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-violet-400 transition'

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
}

function startNew() {
  selectedId.value = 'new'
  Object.assign(draft, { title: '', content: '', tags: activeTag.value === 'ALL' ? '' : activeTag.value })
  preview.value = false
}

function closeEditor() {
  selectedId.value = null
}

async function save() {
  if (!draft.title.trim()) {
    toast.error('标题不能为空')
    return
  }
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

function openNoteMenu(note, x, y) {
  const w = 152
  const h = 2 * 34 + 12
  const pad = 8
  ctxMenu.value = {
    note,
    x: Math.max(pad, Math.min(x ?? 0, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y ?? 0, window.innerHeight - h - pad)),
  }
  window.addEventListener('scroll', closeNoteMenu, { capture: true, once: true })
}

function closeNoteMenu() {
  ctxMenu.value = null
  pressFired = false
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
    openNoteMenu(note, touch.clientX, touch.clientY)
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
  if (ctxMenu.value) return
  openNote(note)
}

function ctxOpen() {
  const note = ctxMenu.value?.note
  closeNoteMenu()
  if (note) openNote(note)
}

function ctxDelete() {
  const note = ctxMenu.value?.note
  closeNoteMenu()
  if (!note) return
  pendingDelete.value = note
  confirmOpen.value = true
}

function askDeleteFromDetail() {
  pendingDelete.value = { id: selectedId.value, title: draft.title }
  confirmOpen.value = true
}

const activeNote = computed(() => notes.value.find((n) => n.id === selectedId.value) || null)

function focusSearch() {
  nextTick(() => searchEl.value?.focus())
}

function onSearchKeydown(e) {
  if (e.key === 'Escape' && ctxMenu.value) {
    closeNoteMenu()
    return
  }
  const tag = document.activeElement?.tagName
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)
  if (typing) return
  if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    if (selectedId.value != null) return
    focusSearch()
  }
}

onMounted(() => {
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
        <div class="relative">
          <Icon name="search" :size="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            ref="searchEl"
            v-model="search"
            type="text"
            placeholder="搜索（/）"
            class="w-36 sm:w-52 pl-8 pr-2.5 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-400 transition"
            @keydown.esc="search = ''"
          />
        </div>
        <button
          class="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white text-xs font-mono border border-violet-400/30 transition"
          @click="startNew"
        >
          <Icon name="plus" :size="14" /> 新建
        </button>
      </div>

      <div v-if="allTags.length" class="flex-shrink-0 flex items-center gap-1 overflow-x-auto no-scrollbar pb-1.5 mb-1 text-[11px] font-mono">
        <button
          class="px-2 py-0.5 rounded-lg whitespace-nowrap border transition-all"
          :class="activeTag === 'ALL' ? 'bg-violet-600 text-white border-violet-400/40' : 'bg-white/5 text-slate-400 border-white/5'"
          @click="activeTag = 'ALL'"
        >
          全部
        </button>
        <button
          v-for="tag in allTags"
          :key="tag"
          class="px-2 py-0.5 rounded-lg whitespace-nowrap border transition-all"
          :class="activeTag === tag ? 'bg-violet-600 text-white border-violet-400/40' : 'bg-white/5 text-slate-400 border-white/5'"
          @click="activeTag = tag"
        >
          {{ tag }}
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
        <div v-if="loading" class="h-full min-h-[8rem] flex items-center justify-center text-slate-500 font-mono text-xs">加载中…</div>
        <EmptyState v-else-if="visible.length === 0" icon="note" title="暂无笔记" description="点击「新建」开始写。" />
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-1">
          <button
            v-for="note in visible"
            :key="note.id"
            class="group flex flex-col text-left rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 hover:border-violet-400/40 hover:bg-slate-900/80 transition p-3 min-h-[7.5rem]"
            @click="onNoteCardClick(note)"
            @contextmenu.prevent="onNoteCtx(note, $event)"
            @touchstart.passive="onNotePressStart(note, $event)"
            @touchmove="onNotePressEnd"
            @touchend="onNotePressEnd"
            @touchcancel="onNotePressEnd"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-slate-100 truncate">{{ note.title }}</span>
              <span class="text-[9px] text-slate-500 font-mono shrink-0">{{ relativeTime(note.updated_at) }}</span>
            </div>
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
          placeholder="笔记标题"
        />
        <button
          class="p-1.5 rounded-xl border transition"
          :class="preview ? 'bg-violet-600/80 text-white border-violet-400/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'"
          :title="preview ? '编辑' : '预览'"
          @click="preview = !preview"
        >
          <Icon name="note" :size="15" />
        </button>
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 disabled:opacity-60 text-white text-xs font-mono border border-violet-400/30 transition"
          :disabled="saving"
          @click="save"
        >
          <Icon name="check" :size="14" /> 保存
        </button>
        <button
          v-if="selectedId !== 'new'"
          class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-rose-400 transition"
          title="删除"
          @click="askDeleteFromDetail"
        >
          <Icon name="trash" :size="15" />
        </button>
      </div>

      <div class="flex-1 min-h-0 flex flex-col gap-2">
        <div class="flex-shrink-0 flex items-center gap-2">
          <span class="text-[10px] text-slate-500 font-mono shrink-0">标签</span>
          <input v-model="draft.tags" :class="inputClass" placeholder="逗号分隔，如：运维, 部署" />
        </div>

        <div class="flex-1 min-h-0 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 overflow-hidden flex flex-col">
          <textarea
            v-if="!preview"
            v-model="draft.content"
            class="flex-1 w-full resize-none bg-transparent p-3.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none selectable"
            placeholder="支持 Markdown：# 标题、**粗体**、`代码`、- 列表、> 引用、``` 代码块 ```"
          />
          <div v-else class="md-preview flex-1 overflow-y-auto custom-scroll p-3.5" v-html="renderedHtml" />
        </div>

        <div class="flex-shrink-0 flex items-center justify-between gap-2">
          <span class="text-[10px] text-slate-500 font-mono">
            <template v-if="activeNote">最近编辑 {{ relativeTime(activeNote.updated_at) }} · 创建 {{ activeNote.created_at }}</template>
            <template v-else>新笔记</template>
          </span>
        </div>
      </div>
    </template>

    <!-- 笔记操作菜单：右键 / 长按调起；Teleport 到 body 避免祖先 transform 影响 fixed 定位 -->
    <Teleport to="body">
      <div v-if="ctxMenu" class="fixed inset-0 z-40" @click="closeNoteMenu" @contextmenu.prevent="closeNoteMenu" />
      <div
        v-if="ctxMenu"
        class="fixed z-50 w-[152px] rounded-xl bg-slate-900 border border-white/15 shadow-xl shadow-black/50 p-1 text-xs"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/10 transition" @click="ctxOpen">
          打开
        </button>
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition" @click="ctxDelete">
          删除
        </button>
      </div>
    </Teleport>

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除笔记"
      :message="(pendingDelete?.title || draft.title) ? `确定删除「${pendingDelete?.title || draft.title}」吗？` : '确定删除这篇笔记吗？'"
      @confirm="doDelete"
    />
  </div>
</template>
