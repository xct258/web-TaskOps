<script setup>
import { computed, ref, watch } from 'vue'

import { api } from '@/api'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { cycleLabel, formatDate, todayISO } from '@/utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  todo: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

const toast = useToast()

const history = ref([])
const viewYear = ref(0)
const viewMonth = ref(0)

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const pad = (value) => String(value).padStart(2, '0')

const doneSet = computed(() => new Set(history.value))
const total = computed(() => history.value.length)
const latest = computed(() => history.value[0] || '')
const monthPrefix = computed(() => `${viewYear.value}-${pad(viewMonth.value)}`)
const monthCount = computed(() => history.value.filter((d) => d.startsWith(monthPrefix.value)).length)
const monthTitle = computed(() => `${viewYear.value}年${viewMonth.value}月`)

// 六周网格，首日对齐周一（与 DatePicker 的日历保持一致）
const cells = computed(() => {
  if (!viewYear.value || !viewMonth.value) return []
  const firstDay = new Date(viewYear.value, viewMonth.value - 1, 1).getDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  const today = todayISO()
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(viewYear.value, viewMonth.value - 1, index - offset + 1)
    const iso = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    return {
      iso,
      day: value.getDate(),
      currentMonth: value.getMonth() === viewMonth.value - 1,
      done: doneSet.value.has(iso),
      today: iso === today,
    }
  })
})

const cellClass = (cell) => {
  if (cell.done) return 'bg-emerald-500/85 text-white font-bold'
  if (cell.today) return 'text-white ring-1 ring-inset ring-sky-400/60'
  return cell.currentMonth ? 'text-slate-300' : 'text-slate-600'
}

function setView(iso) {
  const [year, month] = String(iso || todayISO()).split('-').map(Number)
  viewYear.value = year
  viewMonth.value = month
}

function shiftMonth(amount) {
  const next = new Date(viewYear.value, viewMonth.value - 1 + amount, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth() + 1
}

async function load() {
  if (!props.todo) return
  try {
    history.value = await api.todos.history(props.todo.id)
  } catch (err) {
    history.value = []
    toast.error(`完成历史加载失败：${err.message}`)
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    history.value = []
    setView(todayISO())
    await load()
    // 有记录就停到最近一次完成的月份，省得打开是一片空白
    if (history.value[0]) setView(history.value[0])
  },
  { immediate: true },
)
</script>

<template>
  <ModalShell
    :model-value="modelValue"
    :title="todo?.title || '完成历史'"
    icon="refresh"
    max-width="max-w-sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-400">
        <span
          v-if="cycleLabel(todo)"
          class="px-1.5 py-px rounded-md border bg-indigo-500/15 text-indigo-300 border-indigo-400/30"
        >
          {{ cycleLabel(todo) }}
        </span>
        <span>共完成 <b class="text-slate-100">{{ total }}</b> 次</span>
        <span v-if="latest">最近 {{ formatDate(latest) }}</span>
      </div>

      <div class="rounded-xl border border-white/10 bg-slate-950/60 p-2.5">
        <div class="flex items-center justify-between gap-2 mb-2">
          <button
            type="button"
            class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
            aria-label="上个月"
            @click="shiftMonth(-1)"
          >
            ‹
          </button>
          <div class="text-xs font-semibold text-white tracking-wide">
            {{ monthTitle }}
            <span class="ml-1 text-[10px] font-mono text-slate-500">{{ monthCount }} 次</span>
          </div>
          <button
            type="button"
            class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
            aria-label="下个月"
            @click="shiftMonth(1)"
          >
            ›
          </button>
        </div>

        <div class="grid grid-cols-7 gap-1 text-center mb-1">
          <span v-for="day in WEEKDAYS" :key="day" class="py-1 text-[10px] font-mono text-slate-500">
            {{ day }}
          </span>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center">
          <span v-for="cell in cells" :key="cell.iso" class="aspect-square">
            <span
              class="w-full h-full flex items-center justify-center rounded-lg text-[11px] font-mono"
              :class="cellClass(cell)"
              :title="cell.iso"
            >
              {{ cell.day }}
            </span>
          </span>
        </div>
      </div>

      <p v-if="!total" class="text-[10px] text-slate-500 text-center">
        还没有打卡记录——完成一次循环任务就会记在这里
      </p>
    </div>
  </ModalShell>
</template>
