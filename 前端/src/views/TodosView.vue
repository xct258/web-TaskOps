<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import DatePicker from '@/components/DatePicker.vue'
import PushTimePicker from '@/components/PushTimePicker.vue'
import TodoHistory from '@/components/TodoHistory.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { useContextMenu } from '@/composables/useContextMenu'
import { usePageMenu } from '@/composables/usePageMenu'
import { formatPush, toPushInput, toPushISO } from '@/utils/pushTime'
import {
  CYCLE_OPTIONS,
  PRIORITY_META,
  PRIORITY_OPTIONS,
  cycleLabel,
  daysUntil,
  formatDate,
  parseDate,
  shiftDate,
  todayISO,
} from '@/utils/format'

const toast = useToast()
const menu = useContextMenu()
const pageMenu = usePageMenu()

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
  due_time: '',
  remind_time: '',
  priority: 0,
  cycle_mode: '',
  cycle_days: 7,
  catch_up: false,
  mqtt_enabled: false,
  mqtt_at: '',
})

const confirmOpen = ref(false)
const pendingDelete = ref(null)
const historyOpen = ref(false)
const historyTodo = ref(null)

function openHistory(todo) {
  historyTodo.value = todo
  historyOpen.value = true
}

// 卡片操作菜单：右键 / 长按调起全局菜单；卡片上只保留完成与推迟两个明确按键。
let pressTimer = null
let pressFired = false

function openCardMenu(todo, x, y, fromTouch = false) {
  const menuItems = [{ key: 'edit', label: '编辑', action: () => openEdit(todo) }]
  if (todo?.undo_snapshot) {
    menuItems.push({ key: 'undo', label: '撤销上一次完成', action: () => undo(todo) })
  }
  if (todo?.recurring) {
    menuItems.push({ key: 'history', label: '完成历史', action: () => openHistory(todo) })
  }
  // 「取消」只在未完成时出现；取消后 processed=true + closed_reason='cancelled'，
  // 卡片上的「重开」按钮可以恢复。循环任务用它可以停掉整个循环。
  if (todo && !todo.processed) {
    menuItems.push({ key: 'cancel', label: '取消任务', action: () => cancelTodo(todo) })
  }
  menuItems.push({ key: 'delete', label: '删除', danger: true, action: () => askDelete(todo) })
  menu.open(menuItems, x, y, { title: todo?.content, fromTouch })
}

function onCardCtx(todo, e) {
  openCardMenu(todo, e.clientX, e.clientY)
}

function onPressStart(todo, e) {
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
    openCardMenu(todo, t.clientX, t.clientY, true)
  }, 550)
}

function onPressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function guardCardClick(e) {
  // 长按弹出菜单后松手会补一次 click，用它拦截误触。
  if (pressFired) {
    e.preventDefault()
    e.stopPropagation()
    pressFired = false
  }
}

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-sky-400 transition'
const labelClass = 'block text-slate-400 mb-1'

const FILTERS = [
  { key: 'pending', label: '待处理' },
  { key: 'done', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: 'all', label: '全部' },
]

const stats = computed(() => {
  const today = todayISO()
  const reached = items.value.filter((t) => reachedReminder(t))
  const total = reached.length
  // 已取消同样是 processed=true，只能靠 closed_reason 区分，
  // 否则「已完成」会把取消的任务也算进去、两个页签的数字互相串。
  const cancelled = items.value.filter((t) => t.processed && t.closed_reason === 'cancelled').length
  const done = reached.filter((t) => t.processed && t.closed_reason !== 'cancelled').length
  const pending = reached.filter((t) => !t.processed).length
  const overdue = reached.filter((t) => {
    if (t.processed || !t.due_time) return false
    // 已逾期 = 到期日 < 今天（只是到了提醒日的不算逾期）
    return String(t.due_time).split('T')[0] < today
  }).length
  return { total, done, cancelled, pending, overdue }
})

function reachedReminder(t) {
  if (!t.remind_time) return true
  return String(t.remind_time).slice(0, 10) <= todayISO()
}

function matchesFilter(todo, key) {
  const today = todayISO()
  if (key === 'all') return true
  // 取消的任务也是 processed=true，靠 closed_reason 区分，别混进「已完成」
  if (key === 'done') return todo.processed && todo.closed_reason !== 'cancelled'
  if (key === 'cancelled') return todo.processed && todo.closed_reason === 'cancelled'
  if (key === 'pending') return !todo.processed
  if (key === 'overdue') return !todo.processed && todo.due_time && String(todo.due_time).slice(0, 10) < today
  if (key === 'today') return !todo.processed && todo.due_time && String(todo.due_time).slice(0, 10) === today
  return true
}

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value
    // 提醒日期只约束「待处理」：提醒日期没到的先不冒出来（tickler 式）。
    // 「已完成 / 已取消」不再受它限制，否则提前完成或取消的任务会凭空消失。
    .filter((t) => filter.value !== 'pending' || reachedReminder(t))
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
  if (!todo.due_time) return null
  if (todo.processed) return { label: `到期 ${formatDate(todo.due_time)}`, cls: 'text-slate-500' }
  const d = daysUntil(todo.due_time)
  if (d < 0) return { label: `逾期 ${-d} 天`, cls: 'text-rose-400' }
  if (d === 0) return { label: '今天到期', cls: 'text-amber-300' }
  if (d === 1) return { label: '明天到期', cls: 'text-sky-300' }
  return { label: `${d} 天后 · ${formatDate(todo.due_time)}`, cls: 'text-slate-400' }
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

/* ------------------------- 提醒日期快捷选项 ------------------------- */
// 「提醒日期」默认为空 = 不限制，任务随时出现在「待处理」里。
// 选了到期日期之后，用相对它的快捷项来设：当天 / 提前 N 天 / 自定义。
const REMIND_PRESETS = [
  { key: 'same', label: '当天', offset: 0 },
  { key: 'd3', label: '提前 3 天', offset: 3 },
  { key: 'd7', label: '提前 7 天', offset: 7 },
]
// '' = 不设；same/d3/d7 = 相对到期日期；custom = 自己挑日期
const remindPreset = ref('')

const remindOffsetDays = (due, remind) => Math.round((parseDate(due) - parseDate(remind)) / 86400000)

const remindChipClass = (key) =>
  remindPreset.value === key
    ? 'bg-sky-600 text-white border-sky-400/40'
    : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'

function applyPreset(preset) {
  // 再点一次同一个 = 取消设置，回到「不设提醒日期」
  if (remindPreset.value === preset.key) {
    remindPreset.value = ''
    form.remind_time = ''
    return
  }
  remindPreset.value = preset.key
  form.remind_time = shiftDate(form.due_time, -preset.offset)
}

function pickCustomRemind() {
  remindPreset.value = 'custom'
  // 给个起点，否则日历会停在当前月、且看不出原来选的是哪天
  if (!form.remind_time) form.remind_time = form.due_time
}

function deriveRemindPreset(remind, due) {
  if (!remind) return ''
  if (!due) return 'custom'
  const offset = remindOffsetDays(due, remind)
  return REMIND_PRESETS.find((p) => p.offset === offset)?.key ?? 'custom'
}

// 到期日期变了，相对型的快捷项要跟着挪，否则还停在旧的绝对日期上
watch(
  () => form.due_time,
  (due) => {
    const preset = REMIND_PRESETS.find((p) => p.key === remindPreset.value)
    if (!due) {
      // 没有到期日期就没有「相对于它」的提醒日期，循环也配不了（后端也会强制关掉）
      remindPreset.value = ''
      form.remind_time = ''
      form.cycle_mode = ''
    } else if (preset) {
      form.remind_time = shiftDate(due, -preset.offset)
    }
  },
)

// 自定义日历里点了「清除」= 回到「不设」，别让「自定义」一直亮着
watch(
  () => form.remind_time,
  (remind) => {
    if (!remind && remindPreset.value === 'custom') remindPreset.value = ''
  },
)

const remindHint = computed(() => {
  if (!form.remind_time) return '不设提醒日期：一直显示在「待处理」里'
  const label = formatDate(form.remind_time)
  if (!form.due_time) return label
  const days = remindOffsetDays(form.due_time, form.remind_time)
  if (days === 0) return `${label}（到期当天）`
  if (days > 0) return `${label}（到期前 ${days} 天）`
  return `${label}（到期后 ${-days} 天）`
})

function openAdd() {
  editing.value = null
  Object.assign(form, {
    title: '',
    content: '',
    due_time: '',
    remind_time: '',
    priority: 0,
    cycle_mode: '',
    cycle_days: 7,
    catch_up: false,
    mqtt_enabled: false,
    mqtt_at: '',
  })
  remindPreset.value = ''
  modalOpen.value = true
}

function openEdit(todo) {
  editing.value = todo
  const due = todo.due_time ? String(todo.due_time).slice(0, 10) : ''
  const remind = todo.remind_time ? String(todo.remind_time).slice(0, 10) : ''
  Object.assign(form, {
    title: todo.title,
    content: todo.content,
    due_time: due,
    remind_time: remind,
    priority: todo.priority ?? 0,
    cycle_mode: todo.recurring ? todo.cycle_mode || '' : '',
    cycle_days: todo.cycle_days || 7,
    catch_up: !!todo.catch_up,
    mqtt_enabled: !!todo.mqtt_enabled,
    mqtt_at: toPushInput(todo.mqtt_at),
  })
  remindPreset.value = deriveRemindPreset(remind, due)
  modalOpen.value = true
}

function toggleMqtt() {
  form.mqtt_enabled = !form.mqtt_enabled
  if (form.mqtt_enabled && !form.mqtt_at) {
    // 两个日期都可以不设，兜底用今天，免得推送时间留空还要用户手挑
    const date = form.remind_time || form.due_time || todayISO()
    form.mqtt_at = date ? toPushISO(`${date}T09:00`) : ''
  }
}

async function save() {
  if (!form.title.trim() || !form.content.trim()) {
    toast.error('标题与内容为必填项')
    return
  }
  const payload = {
    title: form.title.trim(),
    content: form.content.trim(),
    due_time: form.due_time || null,
    remind_time: form.remind_time || null,
    priority: Number(form.priority) || 0,
    catch_up: form.catch_up,
    mqtt_enabled: form.mqtt_enabled,
  }
  payload.cycle_mode = form.cycle_mode || 'none'
  if (form.cycle_mode === 'days') payload.cycle_days = Number(form.cycle_days) || 1
  if (form.mqtt_enabled) {
    if (!form.mqtt_at) {
      toast.error('请先选择 MQTT 推送时间')
      return
    }
    payload.mqtt_at = toPushISO(form.mqtt_at)
    if (!payload.mqtt_at) {
      toast.error('MQTT 推送时间格式无效')
      return
    }
  } else {
    payload.mqtt_at = null
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
    loadSummary()
  } catch (err) {
    toast.error(`操作失败：${err.message}`)
  }
}

async function cancelTodo(todo) {
  try {
    replace(await api.todos.update(todo.id, { processed: true, closed_reason: 'cancelled' }))
    toast.info('已取消，可在「已取消」页签里重开')
    loadSummary()
  } catch (err) {
    toast.error(`取消失败：${err.message}`)
  }
}

async function undo(todo) {
  try {
    replace(await api.todos.undo(todo.id))
    toast.info('已撤销上一次完成')
    loadSummary()
  } catch (err) {
    toast.error(`撤销失败：${err.message}`)
  }
}

async function reopen(todo) {
  try {
    replace(await api.todos.update(todo.id, { processed: false }))
    toast.info('已重新打开')
    loadSummary()
  } catch (err) {
    toast.error(`操作失败：${err.message}`)
  }
}

async function snooze(todo) {
  try {
    replace(await api.todos.snooze(todo.id))
    toast.info('已推迟一个周期')
    loadSummary()
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
  pageMenu.setMenu([
    { key: 'new', label: '新建待办', action: openAdd },
    { key: 'refresh', label: '刷新', action: load },
  ], '待办')
  load()
  window.addEventListener('keydown', onSearchKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onSearchKeydown))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 工具条 -->
    <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-2">
      <div
        class="min-w-0 flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar overscroll-x-contain snap-x snap-mandatory pb-1 text-xs font-mono"
        role="tablist"
        aria-label="待办状态筛选"
      >
        <button
          v-for="f in FILTERS"
          :key="f.key"
          class="shrink-0 snap-start px-2.5 py-1 rounded-xl whitespace-nowrap border transition-all touch-pan-x"
          role="tab"
          :aria-selected="filter === f.key"
          :class="
            filter === f.key
              ? 'bg-sky-600 text-white border-sky-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'
          "
          @click="filter = f.key"
        >
          {{ f.label }}
          <span v-if="f.key === 'pending'" class="opacity-70">{{ stats.pending }}</span>
          <span v-else-if="f.key === 'cancelled' && stats.cancelled" class="text-amber-300 font-bold bg-amber-500/10 px-1 rounded">{{ stats.cancelled }}</span>
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
          class="group relative flex items-start gap-2.5 p-3 rounded-2xl bg-slate-900/55 hover:bg-slate-900/80 border border-white/10 transition-all"
          :class="{
            'hover:border-rose-400/40':
              !todo.processed && todo.due_time && String(todo.due_time).slice(0, 10) < todayISO(),
            'hover:border-sky-400/40': !(!todo.processed && todo.due_time && String(todo.due_time).slice(0, 10) < todayISO()),
          }"
          @click.capture="guardCardClick"
          @contextmenu.prevent="onCardCtx(todo, $event)"
          @touchstart.passive="onPressStart(todo, $event)"
          @touchmove="onPressEnd"
          @touchend="onPressEnd"
          @touchcancel="onPressEnd"
        >
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
                v-if="todo.processed"
                class="text-[9px] font-mono px-1.5 py-px rounded-md border"
                :class="todo.closed_reason === 'cancelled' ? 'bg-amber-500/15 text-amber-300 border-amber-400/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'"
              >
                {{ todo.closed_reason === 'cancelled' ? '已取消' : '已完成' }}
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
              <span v-if="todo.remind_time" class="text-slate-500">
                提醒 {{ formatDate(todo.remind_time) }}
              </span>
              <span v-if="todo.mqtt_enabled && todo.mqtt_at" class="flex items-center gap-1 text-sky-400/90">
                <Icon name="share" :size="10" />
                MQTT {{ formatPush(todo.mqtt_at) }}
              </span>
              <!-- 循环任务：点「上次完成」看打卡日历（一次性任务没有历史，保持纯文本） -->
              <button
                v-if="todo.last_completed_date && todo.recurring"
                class="text-emerald-500/80 hover:text-emerald-300 underline decoration-dotted underline-offset-2 transition"
                title="查看完成历史"
                @click.stop="openHistory(todo)"
              >
                上次 {{ formatDate(todo.last_completed_date) }}
              </button>
              <span v-else-if="todo.last_completed_date" class="text-emerald-500/80">
                上次 {{ formatDate(todo.last_completed_date) }}
              </span>
            </div>
          </div>

          <div class="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              v-if="!todo.processed"
              class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] font-mono text-slate-300 bg-white/5 hover:bg-emerald-500/20 hover:text-emerald-300 border border-white/10 transition"
              title="标记完成"
              @click.stop="complete(todo)"
            >
              <Icon name="check" :size="11" />
              完成
            </button>
            <button
              v-else
              class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] font-mono text-slate-400 bg-white/5 hover:bg-sky-500/20 hover:text-sky-300 border border-white/10 transition"
              title="重新打开"
              @click.stop="reopen(todo)"
            >
              <Icon name="undo" :size="11" />
              重开
            </button>
            <button
              v-if="!todo.processed && todo.due_time"
              class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] font-mono text-slate-300 bg-white/5 hover:bg-amber-500/20 hover:text-amber-300 border border-white/10 transition"
              title="推迟一个周期"
              @click.stop="snooze(todo)"
            >
              <Icon name="clock" :size="11" />
              推迟
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

        <div>
          <label :class="labelClass">到期日期 <span class="text-slate-500">（可选）</span></label>
          <DatePicker v-model="form.due_time" placeholder="不设到期日期" />
        </div>

        <!-- 提醒日期默认留空（= 不受提醒日期限制）；设了到期日期才给相对于它的快捷项 -->
        <div v-if="form.due_time">
          <label :class="labelClass">提醒日期</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in REMIND_PRESETS"
              :key="preset.key"
              type="button"
              class="px-2.5 py-1 rounded-xl text-[11px] font-mono whitespace-nowrap border transition"
              :class="remindChipClass(preset.key)"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </button>
            <button
              type="button"
              class="px-2.5 py-1 rounded-xl text-[11px] font-mono whitespace-nowrap border transition"
              :class="remindChipClass('custom')"
              @click="pickCustomRemind"
            >
              自定义
            </button>
          </div>
          <div v-if="remindPreset === 'custom'" class="mt-1.5">
            <DatePicker v-model="form.remind_time" />
          </div>
          <p class="mt-1 text-[10px] text-slate-500">{{ remindHint }}</p>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label :class="labelClass">优先级</label>
            <select v-model.number="form.priority" :class="inputClass">
              <option v-for="opt in PRIORITY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div>
            <label :class="labelClass">
              循环
              <span v-if="!form.due_time" class="text-slate-500">（需先设到期日期）</span>
            </label>
            <select
              v-model="form.cycle_mode"
              :class="[inputClass, form.due_time ? '' : 'opacity-40 cursor-not-allowed']"
              :disabled="!form.due_time"
              :title="form.due_time ? '' : '设了到期日期才能配置循环'"
            >
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

        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10">
          <div>
            <div class="text-slate-200">MQTT 消息提醒</div>
            <div class="text-[10px] text-slate-500 mt-0.5">勾选后选择具体的 MQTT 推送日期和时间</div>
          </div>
          <button
            class="relative w-9 h-5 rounded-full transition flex-shrink-0"
            :class="form.mqtt_enabled ? 'bg-sky-500' : 'bg-slate-700'"
            @click="toggleMqtt"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              :class="form.mqtt_enabled ? 'translate-x-4' : ''"
            />
          </button>
        </div>

        <div v-if="form.mqtt_enabled">
          <label :class="labelClass">MQTT 推送时间（北京时间）</label>
          <PushTimePicker v-model="form.mqtt_at" />
        </div>
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

    <TodoHistory v-model="historyOpen" :todo="historyTodo" />

    <!-- 卡片操作菜单由全局 ContextMenu 统一渲染（右键 / 长按） -->
  </div>
</template>
