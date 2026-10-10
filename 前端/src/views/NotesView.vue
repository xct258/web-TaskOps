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
const searchOpen = ref(false)
const searchEl = ref(null)

const selectedId = ref(null) // number | 'new' | null
const draft = reactive({ title: '', content: '', tags: '' })
const preview = ref(false)
const saving = ref(false)

const confirmOpen = ref(false)

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
  const id = selectedId.value
  try {
    await api.notes.remove(id)
    notes.value = notes.value.filter((n) => n.id !== id)
    selectedId.value = null
    toast.success('笔记已删除')
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
  }
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
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    openSearch()
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
    <div class="flex-1 min-h-0 flex gap-2.5">
      <!-- 左侧列表 -->
      <div class="flex-col min-h-0 w-full md:w-64 lg:w-72 shrink-0" :class="selectedId != null ? 'hidden md:flex' : 'flex'">
        <div class="flex-shrink-0 flex items-center gap-1.5 mb-2">
          <button
            class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition"
            title="搜索（/）"
            @click="toggleSearch"
          >
            <Icon name="search" :size="13" />
          </button>
          <div v-if="searchOpen" class="relative flex-1 min-w-0">
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
            class="p-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white border border-violet-400/30 transition"
            title="新建笔记"
            @click="startNew"
          >
            <Icon name="plus" :size="15" />
          </button>
        </div>

        <div v-if="allTags.length" class="flex-shrink-0 flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 mb-1 text-[11px] font-mono">
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

        <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1 space-y-1.5">
          <div v-if="loading" class="h-full min-h-[8rem] flex items-center justify-center text-slate-500 font-mono text-xs">加载中…</div>
          <EmptyState v-else-if="visible.length === 0" icon="note" title="暂无笔记" description="点击右上角 + 新建。" />
          <button
            v-for="note in visible"
            :key="note.id"
            class="w-full text-left p-2.5 rounded-xl border transition"
            :class="
              selectedId === note.id
                ? 'bg-violet-600/20 border-violet-400/40'
                : 'bg-slate-900/55 border-white/10 hover:border-violet-400/30'
            "
            @click="openNote(note)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-slate-100 truncate">{{ note.title }}</span>
              <span class="text-[9px] text-slate-500 font-mono shrink-0">{{ relativeTime(note.updated_at) }}</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{{ excerpt(note.content) || '（空笔记）' }}</p>
            <div v-if="(note.tags || []).length" class="flex items-center gap-1 mt-1 flex-wrap">
              <span
                v-for="t in note.tags.slice(0, 3)"
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

      <!-- 右侧编辑器 -->
      <div class="flex-1 min-h-0 flex-col gap-2" :class="selectedId != null ? 'flex' : 'hidden md:flex'">
        <template v-if="selectedId != null">
          <div class="flex-shrink-0 flex items-center gap-2">
            <button
              class="md:hidden p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300"
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
              class="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 disabled:opacity-60 text-white text-xs font-mono border border-violet-400/30 transition"
              :disabled="saving"
              @click="save"
            >
              <Icon name="check" :size="14" /> 保存
            </button>
            <button
              v-if="selectedId !== 'new'"
              class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-rose-400 transition"
              title="删除"
              @click="confirmOpen = true"
            >
              <Icon name="trash" :size="15" />
            </button>
          </div>

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
            <button
              class="lg:hidden flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 disabled:opacity-60 text-white text-xs font-mono border border-violet-400/30 transition"
              :disabled="saving"
              @click="save"
            >
              <Icon name="check" :size="14" /> 保存
            </button>
          </div>
        </template>

        <div v-else class="flex-1 flex items-center justify-center">
          <EmptyState icon="note" title="选择一篇笔记" description="从左侧列表选择，或点击 + 新建一篇。" />
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除笔记"
      :message="draft.title ? `确定删除「${draft.title}」吗？` : '确定删除这篇笔记吗？'"
      @confirm="doDelete"
    />
  </div>
</template>
