<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import {
  CYCLE_LABELS,
  CYCLE_OPTIONS,
  PRIORITY_META,
  PRIORITY_OPTIONS,
  daysUntil,
  formatDate,
  parseDate,
  todayISO,
} from '@/utils/format'

const toast = useToast()

const items = ref([])
const loading = ref(true)
const filter = ref('pending')
const search = ref('')
const searchOpen = ref(false)
const searchEl = ref(null)

const modalOpen = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = reactive({
  title: '',
  content: '',
  need_remind: false,
  due_time: '',
  advance_days: 3,
  priority: 0,
  cycle_mode: '',
  cycle_days: 7,
  catch_up: false,
})

const confirmOpen = ref(false)
const pendingDelete = ref(null)

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-sky-400 transition'
const labelClass = 'block text-slate-400 mb-1'

const FILTERS = [
  { key: 'pending', label: '待处理' },
  { key: 'overdue', label: '逾期' },
  { key: 'today', label: '今日到期' },
  { key: 'done', label: '已完成' },
  { key: 'all', label: '全部' },
]

const stats = computed(() => {
  const today = todayISO()
  const total = items.value.length
  const done = items.value.filter((t) => t.processed).length
  const overdue = items.value.filter(
    (t) => !t.processed && t.need_remind && t.due_time && String(t.due_time) < today,
  ).length
  return { total, done, pending: total - done, overdue }
})

function matchesFilter(todo, key) {
  const today = todayISO()
  if (key === 'all') return true
  if (key === 'done') return todo.processed
  if (key === 'pending') return !todo.processed
  if (key === 'overdue') return !todo.processed && todo.need_remind && todo.due_time && String(todo.due_time) < today
  if (key === 'today') return !todo.processed && todo.need_remind && String(todo.due_time) === today
  return true
}

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value
    .filter((t) => matchesFilter(t, filter.value))
    .filter((t) => !q || [t.title, t.content].filter(Boolean).some((f) => String(f).toLowerCase().includes(q)))
    .sort((a, b) => {
      if (a.processed !== b.processed) return a.processed ? 1 : -1
      const da = a.due_time ? parseDate(a.due_time).getTime() : Infinity
      const db = b.due_time ? parseDate(b.due_time).getTime() : Infinity
      if (da !== db) return da - db
      return (b.priority || 0) - (a.priority || 0)
    })
})

function dueStatus(todo) {
  if (!todo.need_remind || !todo.due_time) return null
  if (todo.processed) return { label: `到期 ${formatDate(todo.due_time)}`, cls: 'text-slate-500' }
  const d = daysUntil(todo.due_time)
  if (d < 0) return { label: `逾期 ${-d} 天`, cls: 'text-rose-400' }
  if (d === 0) return { label: '今天到期', cls: 'text-amber-300' }
  if (d === 1) return { label: '明天到期', cls: 'text-sky-300' }
  return { label: `${d} 天后 · ${formatDate(todo.due_time)}`, cls: 'text-slate-400' }
}

function cycleLabel(todo) {
  if (!todo.recurring) return null
  const base = CYCLE_LABELS[todo.cycle_mode] || '循环'
  return todo.cycle_mode === 'days' ? `每 ${todo.cycle_days || 1} 天` : base
}

async function load() {
  loading.value = true
  try {
    items.value = await api.todos.list()
  } catch (err) {
    toast.error(`待办加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function replace(updated) {
  const idx = items.value.findIndex((t) => t.id === updated.id)
  if (idx >= 0) items.value[idx] = updated
  loadSummary()
}

function openAdd() {
  editing.value = null
  Object.assign(form, {
    title: '',
    content: '',
    need_remind: false,
    due_time: todayISO(),
    advance_days: 3,
    priority: 0,
    cycle_mode: '',
    cycle_days: 7,
    catch_up: false,
  })
  modalOpen.value = true
}

function openEdit(todo) {
  editing.value = todo
  Object.assign(form, {
    title: todo.title,
    content: todo.content,
    need_remind: !!todo.need_remind,
    due_time: todo.due_time || todayISO(),
    advance_days: todo.advance_days ?? 3,
    priority: todo.priority ?? 0,
    cycle_mode: todo.recurring ? todo.cycle_mode || '' : '',
    cycle_days: todo.cycle_days || 7,
    catch_up: !!todo.catch_up,
  })
  modalOpen.value = true
}

async function save() {
  if (!form.title.trim() || !form.content.trim()) {
    toast.error('标题与内容为必填项')
    return
  }
  const payload = {
    title: form.title.trim(),
    content: form.content.trim(),
    need_remind: form.need_remind,
    priority: Number(form.priority) || 0,
    catch_up: form.catch_up,
  }
  if (form.need_remind) {
    payload.due_time = form.due_time || todayISO()
    payload.advance_days = Number(form.advance_days) || 0
    payload.cycle_mode = form.cycle_mode || 'none'
    if (form.cycle_mode === 'days') payload.cycle_days = Number(form.cycle_days) || 1
  }

  saving.value = true
  try {
    if (editing.value) {
      replace(await api.todos.update(editing.value.id, payload))
      toast.success('待办已更新')
    } else {
      items.value.push(await api.todos.create(payload))
      toast.success('待办已添加')
      loadSummary()
    }
    modalOpen.value = false
  } catch (err) {
    toast.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

async function complete(todo) {
  try {
    replace(await api.todos.markProcessed(todo.id))
    toast.success(todo.recurring ? '已打卡，顺延至下一周期' : '已完成')
  } catch (err) {
    toast.error(`操作失败：${err.message}`)
  }
}

async function undo(todo) {
  try {
    replace(await api.todos.undo(todo.id))
    toast.info('已撤销上一次完成')
  } catch (err) {
    toast.error(`撤销失败：${err.message}`)
  }
}

async function reopen(todo) {
  try {
    replace(await api.todos.update(todo.id, { processed: false }))
    toast.info('已重新打开')
  } catch (err) {
    toast.error(`操作失败：${err.message}`)
  }
}

async function snooze(todo) {
  try {
    replace(await api.todos.snooze(todo.id))
    toast.info('已推迟一个周期')
  } catch (err) {
    toast.error(`推迟失败：${err.message}`)
  }
}

function askDelete(todo) {
  pendingDelete.value = todo
  confirmOpen.value = true
}

async function doDelete() {
  if (!pendingDelete.value) return
  try {
    await api.todos.remove(pendingDelete.value.id)
    items.value = items.value.filter((t) => t.id !== pendingDelete.value.id)
    toast.success('待办已删除')
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
    pendingDelete.value = null
  }
}

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
    <!-- 工具条 -->
    <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-2">
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-mono">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          class="px-2.5 py-1 rounded-xl whitespace-nowrap border transition-all"
          :class="
            filter === f.key
              ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30 font-bold border-sky-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'
          "
          @click="filter = f.key"
        >
          {{ f.label }}
          <span v-if="f.key === 'pending'" class="opacity-70">{{ stats.pending }}</span>
          <span v-else-if="f.key === 'overdue' && stats.overdue" class="opacity-70">{{ stats.overdue }}</span>
        </button>
      </div>

      <button
        class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition ml-auto"
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
          class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-sky-400 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none transition"
          @keydown.esc="closeSearch"
        />
      </div>

      <button
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600/80 hover:bg-sky-600 text-white text-xs font-mono transition border border-sky-400/30 shadow-lg shadow-sky-500/10"
        @click="openAdd"
      >
        <Icon name="plus" :size="14" />
        <span class="hidden xs:inline">新建待办</span>
      </button>
    </div>

    <!-- 列表 -->
    <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
      <div v-if="loading" class="h-full min-h-[12rem] flex items-center justify-center text-slate-500 font-mono text-xs">
        正在加载待办…
      </div>

      <EmptyState
        v-else-if="visible.length === 0"
        icon="checkCircle"
        title="这里空空如也"
        description="没有符合当前筛选的待办事项。"
      />

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <div
          v-for="todo in visible"
          :key="todo.id"
          class="group relative flex items-start gap-2.5 p-3 rounded-2xl bg-slate-900/55 hover:bg-slate-900/80 backdrop-blur-md border border-white/10 transition-all"
          :class="{
            'hover:border-rose-400/40':
              !todo.processed && todo.need_remind && todo.due_time && String(todo.due_time) < todayISO(),
            'hover:border-sky-400/40': !(!todo.processed && todo.need_remind && todo.due_time && String(todo.due_time) < todayISO()),
          }"
        >
          <button
            class="mt-0.5 text-slate-400 hover:text-sky-400 transition flex-shrink-0"
            :title="todo.processed ? '重新打开' : '标记完成'"
            @click="todo.processed ? reopen(todo) : complete(todo)"
          >
            <Icon v-if="todo.processed" name="checkCircle" :size="17" class="text-emerald-400" />
            <span v-else class="block h-4 w-4 rounded-full border-2 border-slate-500 group-hover:border-sky-400 transition" />
          </button>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                class="text-xs font-semibold leading-tight"
                :class="todo.processed ? 'text-slate-500 line-through' : 'text-slate-100'"
              >
                {{ todo.title }}
              </span>
              <span
                v-if="todo.priority > 0"
                class="text-[9px] font-mono px-1.5 py-px rounded-md border"
                :class="PRIORITY_META[todo.priority].badge"
              >
                {{ PRIORITY_META[todo.priority].label }}
              </span>
              <span
                v-if="todo.recurring"
                class="text-[9px] font-mono px-1.5 py-px rounded-md border bg-indigo-500/15 text-indigo-300 border-indigo-400/30"
              >
                <Icon name="refresh" :size="9" class="inline -mt-px" /> {{ cycleLabel(todo) }}
              </span>
            </div>

            <p class="text-[11px] text-slate-400 mt-1 selectable line-clamp-2">{{ todo.content }}</p>

            <div class="flex items-center gap-2.5 mt-1.5 text-[10px] font-mono flex-wrap">
              <span v-if="dueStatus(todo)" class="flex items-center gap-1" :class="dueStatus(todo).cls">
                <Icon name="calendar" :size="10" />
                {{ dueStatus(todo).label }}
              </span>
              <span v-if="todo.need_remind && todo.remind_time" class="text-slate-500">
                提醒 {{ formatDate(todo.remind_time) }}
              </span>
              <span v-if="!todo.need_remind" class="text-slate-600">免提醒</span>
              <span v-if="todo.last_completed_date" class="text-emerald-500/80">
                上次 {{ formatDate(todo.last_completed_date) }}
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
            <button
              v-if="!todo.processed && todo.need_remind"
              class="p-1 rounded text-slate-500 hover:text-amber-300 hover:bg-white/5"
              title="推迟一个周期"
              @click="snooze(todo)"
            >
              <Icon name="clock" :size="14" />
            </button>
            <button
              v-if="todo.undo_snapshot"
              class="p-1 rounded text-slate-500 hover:text-sky-300 hover:bg-white/5"
              title="撤销上一次完成"
              @click="undo(todo)"
            >
              <Icon name="undo" :size="14" />
            </button>
            <button class="p-1 rounded text-slate-500 hover:text-sky-300 hover:bg-white/5" title="编辑" @click="openEdit(todo)">
              <Icon name="edit" :size="14" />
            </button>
            <button class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-white/5" title="删除" @click="askDelete(todo)">
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑 -->
    <ModalShell v-model="modalOpen" :title="editing ? '编辑待办' : '新建待办'" icon="list" max-width="max-w-md">
      <div class="space-y-2.5 text-xs">
        <div>
          <label :class="labelClass">标题</label>
          <input v-model="form.title" :class="inputClass" placeholder="例如: 交电费" />
        </div>
        <div>
          <label :class="labelClass">内容 / 备注</label>
          <textarea v-model="form.content" :class="inputClass" rows="2" placeholder="主卧电表，户号 123456" />
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10">
          <div>
            <div class="text-slate-200">开启到期提醒</div>
            <div class="text-[10px] text-slate-500 mt-0.5">关闭后只保留标题内容，不参与日历与逾期统计</div>
          </div>
          <button
            class="relative w-9 h-5 rounded-full transition flex-shrink-0"
            :class="form.need_remind ? 'bg-sky-500' : 'bg-slate-700'"
            @click="form.need_remind = !form.need_remind"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              :class="form.need_remind ? 'translate-x-4' : ''"
            />
          </button>
        </div>

        <template v-if="form.need_remind">
          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label :class="labelClass">到期日</label>
              <input v-model="form.due_time" type="date" :class="inputClass" />
            </div>
            <div>
              <label :class="labelClass">提前提醒（天）</label>
              <input v-model.number="form.advance_days" type="number" min="0" :class="inputClass" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label :class="labelClass">优先级</label>
              <select v-model.number="form.priority" :class="inputClass">
                <option v-for="opt in PRIORITY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div>
              <label :class="labelClass">循环</label>
              <select v-model="form.cycle_mode" :class="inputClass">
                <option v-for="opt in CYCLE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>

          <div v-if="form.cycle_mode === 'days'">
            <label :class="labelClass">循环间隔（天）</label>
            <input v-model.number="form.cycle_days" type="number" min="1" :class="inputClass" />
          </div>

          <div v-if="form.cycle_mode" class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10">
            <div>
              <div class="text-slate-200">逾期逐期补做</div>
              <div class="text-[10px] text-slate-500 mt-0.5">关闭则跳过已错过的周期，直接顺延到未来</div>
            </div>
            <button
              class="relative w-9 h-5 rounded-full transition flex-shrink-0"
              :class="form.catch_up ? 'bg-sky-500' : 'bg-slate-700'"
              @click="form.catch_up = !form.catch_up"
            >
              <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                :class="form.catch_up ? 'translate-x-4' : ''"
              />
            </button>
          </div>
        </template>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2 text-xs font-mono">
          <button class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" @click="modalOpen = false">
            取消
          </button>
          <button
            class="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-medium transition shadow-lg shadow-sky-500/20"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? '保存中…' : editing ? '保存修改' : '创建待办' }}
          </button>
        </div>
      </template>
    </ModalShell>

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除待办"
      :message="pendingDelete ? `确定删除「${pendingDelete.title}」吗？` : ''"
      @confirm="doDelete"
    />
  </div>
</template>
