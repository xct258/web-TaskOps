<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

import Icon from '@/components/Icon.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '选择日期' },
  clearable: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const viewYear = ref(0)
const viewMonth = ref(0)
const mode = ref('day') // day=选日；ym=年月的快捷选择
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const pad = (value) => String(value).padStart(2, '0')

const displayValue = computed(() => {
  if (!props.modelValue) return ''
  const [year, month, day] = props.modelValue.split('-')
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : props.modelValue
})
const monthTitle = computed(() => `${viewYear.value}年${viewMonth.value}月`)
// 已选日期的年/月：月份网格据此高亮，切到别的年份时不再残留高亮。
const selectedYM = computed(() => {
  const [year, month] = String(props.modelValue || '').split('-').map(Number)
  return year && month ? { year, month } : null
})
const isSelectedMonth = (month) =>
  !!selectedYM.value && selectedYM.value.year === viewYear.value && selectedYM.value.month === month
const calendarDays = computed(() => {
  if (!viewYear.value || !viewMonth.value) return []
  const firstDay = new Date(viewYear.value, viewMonth.value - 1, 1).getDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(viewYear.value, viewMonth.value - 1, index - offset + 1)
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    return {
      date,
      day: value.getDate(),
      currentMonth: value.getMonth() === viewMonth.value - 1,
      selected: date === props.modelValue,
    }
  })
})

function setView(value) {
  const [year, month] = String(value || '').split('-').map(Number)
  const now = new Date()
  viewYear.value = year || now.getFullYear()
  viewMonth.value = month || now.getMonth() + 1
}

function openPicker() {
  setView(props.modelValue)
  mode.value = 'day'
  open.value = true
}

function toggle() {
  if (open.value) open.value = false
  else openPicker()
}

function shiftMonth(amount) {
  const next = new Date(viewYear.value, viewMonth.value - 1 + amount, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth() + 1
}

function shiftYear(amount) {
  viewYear.value += amount
}

function selectMonth(month) {
  viewMonth.value = month
  mode.value = 'day'
}

function selectDate(date) {
  emit('update:modelValue', date)
  open.value = false
}

function clear() {
  emit('update:modelValue', '')
  open.value = false
}

function onKeydown(event) {
  if (open.value && event.key === 'Escape') {
    event.stopImmediatePropagation()
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs hover:border-indigo-400/50 transition"
      :class="modelValue ? 'text-white' : 'text-slate-500'"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <span>{{ displayValue || placeholder }}</span>
      <Icon name="calendar" :size="14" class="text-slate-500" />
    </button>

    <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150"
      leave-active-class="transition duration-100"
      enter-from-class="opacity-0 -translate-y-1"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div v-if="open" class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm" @click.self="open = false">
      <section data-date-picker-dialog role="dialog" aria-modal="true" aria-label="选择日期" class="w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-4 shadow-2xl shadow-slate-950/50">
        <div class="flex items-center justify-between gap-2 mb-3">
          <template v-if="mode === 'day'">
            <button type="button" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition" aria-label="上个月" @click="shiftMonth(-1)">‹</button>
            <button type="button" class="px-2 py-1 rounded-lg text-xs font-semibold text-white tracking-wide hover:text-indigo-300 hover:bg-white/5 transition" aria-label="按年月选择" @click="mode = 'ym'">{{ monthTitle }}</button>
            <button type="button" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition" aria-label="下个月" @click="shiftMonth(1)">›</button>
          </template>
          <template v-else>
            <button type="button" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition" aria-label="上一年" @click="shiftYear(-1)">‹</button>
            <div class="text-xs font-semibold text-white tracking-wide">{{ viewYear }}年</div>
            <button type="button" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition" aria-label="下一年" @click="shiftYear(1)">›</button>
          </template>
        </div>

        <template v-if="mode === 'day'">
          <div class="grid grid-cols-7 gap-1 text-center mb-1">
            <span v-for="day in WEEKDAYS" :key="day" class="py-1 text-[10px] font-mono text-slate-500">{{ day }}</span>
          </div>
          <div class="grid grid-cols-7 gap-1 text-center">
            <span v-for="cell in calendarDays" :key="cell.date" class="aspect-square">
              <button
                type="button"
                class="w-full h-full rounded-lg text-[11px] font-mono transition"
                :class="cell.selected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25' : cell.currentMonth ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-white/10 hover:text-slate-300'"
                :title="cell.date"
                :aria-label="cell.date"
                @click="selectDate(cell.date)"
              >
                {{ cell.day }}
              </button>
            </span>
          </div>
        </template>
        <div v-else class="grid grid-cols-3 gap-2 py-1">
          <button
            v-for="month in 12"
            :key="month"
            type="button"
            class="py-2.5 rounded-lg text-[11px] font-mono transition"
            :class="isSelectedMonth(month) ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-300 hover:bg-white/10'"
            :aria-label="`${viewYear}年${month}月`"
            @click="selectMonth(month)"
          >
            {{ month }}月
          </button>
        </div>

        <div class="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-white/10">
          <button v-if="clearable && modelValue" type="button" class="text-[11px] text-rose-300 hover:text-rose-200 transition" @click="clear">清除</button>
          <div></div>
          <button type="button" class="px-3 py-1.5 rounded-lg bg-white/5 text-xs text-slate-300 hover:bg-white/10" @click="open = false">取消</button>
        </div>
      </section>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>
