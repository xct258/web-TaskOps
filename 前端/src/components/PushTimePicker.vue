<script setup>
import { computed, nextTick, onUnmounted, ref } from 'vue'

import { beijingTodayYMD, formatPush, joinPushInput, parsePushInput, pushRelative, shiftYMD, ymdWeekday } from '@/utils/pushTime'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const draftDate = ref('')
const draftHour = ref('')
const draftMinute = ref('')
const viewYear = ref(0)
const viewMonth = ref(0)
const monthChooserOpen = ref(false)
const pickerYear = ref(0)
const pickerMonth = ref(0)
const hourColumn = ref(null)
const minuteColumn = ref(null)
const yearColumn = ref(null)
const monthColumn = ref(null)
const ITEM_HEIGHT = 32
let programmaticScroll = 0

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_INDEX = { 周一: 0, 周二: 1, 周三: 2, 周四: 3, 周五: 4, 周六: 5, 周日: 6 }
const pad = (value) => String(value).padStart(2, '0')

const draftValue = computed(() => joinPushInput(draftDate.value, draftHour.value, draftMinute.value))
const selectedWeekday = computed(() => (draftDate.value ? ymdWeekday(draftDate.value) : ''))
const draftRelative = computed(() => pushRelative(draftValue.value))
const displayParts = computed(() => parsePushInput(props.modelValue))
const displayText = computed(() => (displayParts.value ? `${formatPush(props.modelValue)} ${ymdWeekday(displayParts.value.date)}` : ''))
const displayRelative = computed(() => pushRelative(props.modelValue))
const monthTitle = computed(() => `${viewYear.value}年${viewMonth.value}月`)
const today = computed(() => beijingTodayYMD())
const yearWheelItems = computed(() => Array.from({ length: 21 }, (_, index) => viewYear.value - 10 + index))
const monthWheelItems = Array.from({ length: 12 }, (_, index) => index + 1)

const calendarDays = computed(() => {
  if (!viewYear.value || !viewMonth.value) return []
  const firstWeekday = WEEKDAY_INDEX[ymdWeekday(`${viewYear.value}-${pad(viewMonth.value)}-01`)] ?? 0
  const daysInMonth = new Date(Date.UTC(viewYear.value, viewMonth.value, 0)).getUTCDate()
  const cells = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${viewYear.value}-${pad(viewMonth.value)}-${pad(day)}`
    cells.push({ date, day, today: date === today.value, selected: date === draftDate.value })
  }
  return cells
})

function setView(value) {
  const [year, month] = String(value).split('-').map(Number)
  if (!year || !month) return
  viewYear.value = year
  viewMonth.value = month
}

function openMonthChooser() {
  pickerYear.value = viewYear.value
  pickerMonth.value = viewMonth.value
  monthChooserOpen.value = true
  nextTick(() => {
    syncWheel(yearColumn.value, pickerYear.value, yearWheelItems.value)
    syncWheel(monthColumn.value, pickerMonth.value, monthWheelItems)
  })
}

function confirmMonthChooser() {
  viewYear.value = pickerYear.value
  viewMonth.value = pickerMonth.value
  monthChooserOpen.value = false
}

function cancelMonthChooser() {
  monthChooserOpen.value = false
}

function roundedNow() {
  const now = new Date(Date.now() + 8 * 3600e3)
  const total = now.getUTCHours() * 60 + now.getUTCMinutes()
  const rounded = Math.ceil((total + 1) / 5) * 5
  const date = shiftYMD(today.value, Math.floor(rounded / 1440))
  const minutes = rounded % 1440
  return { date, hour: pad(Math.floor(minutes / 60)), minute: pad(minutes % 60) }
}

function openPicker() {
  const parsed = parsePushInput(props.modelValue)
  const initial = parsed || roundedNow()
  draftDate.value = initial.date
  draftHour.value = initial.hour
  draftMinute.value = MINUTES.includes(initial.minute) ? initial.minute : MINUTES[Math.floor(Number(initial.minute || 0) / 5)]
  setView(initial.date)
  monthChooserOpen.value = false
  open.value = true
  nextTick(() => {
    syncWheel(hourColumn.value, draftHour.value, HOURS)
    syncWheel(minuteColumn.value, draftMinute.value, MINUTES)
    document.querySelector('[data-push-picker-confirm]')?.focus()
  })
}

function syncWheel(element, value, items) {
  if (!element) return
  const index = items.indexOf(value)
  if (index < 0) return
  programmaticScroll += 1
  element.scrollTo({ top: index * ITEM_HEIGHT, behavior: 'auto' })
  window.setTimeout(() => {
    programmaticScroll = Math.max(0, programmaticScroll - 1)
  }, 120)
}

function onWheelScroll(element, items, setter) {
  if (!element || programmaticScroll) return
  clearTimeout(element._scrollTimer)
  element._scrollTimer = window.setTimeout(() => {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(element.scrollTop / ITEM_HEIGHT)))
    setter(items[index])
    syncWheel(element, items[index], items)
  }, 100)
}

function chooseWheel(element, value, items, setter) {
  setter(value)
  syncWheel(element, value, items)
}

function confirm() {
  if (!draftValue.value) return
  emit('update:modelValue', draftValue.value)
  open.value = false
  openKeyListener()
}

function clearTime() {
  emit('update:modelValue', '')
  open.value = false
  openKeyListener()
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false
    openKeyListener()
  }
}

function selectDate(date) {
  draftDate.value = date
}

function buttonClass(active) {
  return active
    ? 'bg-sky-600 text-white border-sky-400/60 shadow-lg shadow-sky-500/20'
    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:border-sky-400/40'
}

function openKeyListener() {
  if (open.value) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}

// Keep the listener lifecycle local to this component without relying on a native input.
function toggleOpen() {
  if (open.value) {
    open.value = false
    openKeyListener()
    return
  }
  openPicker()
  openKeyListener()
}

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div>
    <button
      type="button"
      class="w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs flex items-center justify-between gap-2 hover:border-sky-400/50 transition"
      :class="modelValue ? 'text-white' : 'text-slate-500'"
      @click="toggleOpen"
    >
      <span>{{ displayText || '选择推送时间' }}</span>
      <span v-if="displayRelative" class="text-sky-400 font-mono text-[11px] shrink-0">{{ displayRelative }}</span>
    </button>

    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="open"
          class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
          @click.self="open = false; openKeyListener()"
        >
          <section class="w-full max-w-sm max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-slate-900 border border-white/15 rounded-2xl shadow-2xl p-3 space-y-3">
            <header class="flex items-center justify-between gap-2">
              <button type="button" class="flex-1 px-2 py-1 rounded-lg text-center hover:bg-white/5 transition" @click="openMonthChooser">
                <div class="text-xs font-semibold text-slate-100">{{ monthTitle }} <span class="text-sky-400">⌄</span></div>
                <div class="text-[10px] text-slate-500 font-mono">点击快速选择年月</div>
              </button>
            </header>

            <div class="grid grid-cols-7 gap-1 text-center">
              <span v-for="day in WEEKDAYS" :key="day" class="py-0.5 text-[9px] font-mono text-slate-500">{{ day }}</span>
              <span v-for="(cell, index) in calendarDays" :key="index" class="min-w-0">
                <button
                  v-if="cell"
                  type="button"
                  class="w-full aspect-square rounded-md border text-[11px] font-mono transition"
                  :class="buttonClass(cell.selected)"
                  :title="cell.today ? '今天' : ''"
                  @click="selectDate(cell.date)"
                >
                  {{ cell.day }}
                </button>
              </span>
            </div>

            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-mono text-slate-400">小时</span>
                <span class="text-[10px] text-slate-600">{{ draftDate }} {{ selectedWeekday }}</span>
              </div>
              <div class="grid grid-cols-2 gap-2 text-center text-[10px] font-mono text-slate-500">
                <span>小时 {{ draftHour }}</span>
                <span>分钟 {{ draftMinute }}</span>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div ref="hourColumn" class="relative h-24 overflow-y-auto no-scrollbar rounded-lg border border-white/10 bg-white/5 snap-y snap-mandatory" @scroll="onWheelScroll(hourColumn, HOURS, (value) => (draftHour = value))">
                  <div :style="{ height: '46px' }" />
                  <button v-for="item in HOURS" :key="item" type="button" class="w-full snap-center font-mono text-xs transition" :style="{ height: ITEM_HEIGHT + 'px' }" :class="draftHour === item ? 'text-sky-300 font-bold' : 'text-slate-500'" @click="chooseWheel(hourColumn, item, HOURS, (value) => (draftHour = value))">{{ item }}</button>
                  <div :style="{ height: '46px' }" />
                  <span class="pointer-events-none absolute inset-x-1 top-1/2 h-8 -translate-y-1/2 rounded-md border border-sky-400/30 bg-sky-400/5" />
                </div>
                <div ref="minuteColumn" class="relative h-24 overflow-y-auto no-scrollbar rounded-lg border border-white/10 bg-white/5 snap-y snap-mandatory" @scroll="onWheelScroll(minuteColumn, MINUTES, (value) => (draftMinute = value))">
                  <div :style="{ height: '46px' }" />
                  <button v-for="item in MINUTES" :key="item" type="button" class="w-full snap-center font-mono text-xs transition" :style="{ height: ITEM_HEIGHT + 'px' }" :class="draftMinute === item ? 'text-sky-300 font-bold' : 'text-slate-500'" @click="chooseWheel(minuteColumn, item, MINUTES, (value) => (draftMinute = value))">{{ item }}</button>
                  <div :style="{ height: '46px' }" />
                  <span class="pointer-events-none absolute inset-x-1 top-1/2 h-8 -translate-y-1/2 rounded-md border border-sky-400/30 bg-sky-400/5" />
                </div>
              </div>
            </div>

            <footer class="flex items-center justify-between gap-2">
              <button type="button" class="px-3 py-1.5 rounded-lg text-xs text-rose-300 hover:bg-rose-500/10 transition" @click="clearTime">清除时间</button>
              <div class="flex gap-2">
                <button type="button" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs transition" @click="open = false; openKeyListener()">取消</button>
                <button data-push-picker-confirm type="button" class="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs transition" :disabled="!draftValue" @click="confirm">确定</button>
              </div>
            </footer>

            <div v-if="monthChooserOpen" class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/75 p-5 backdrop-blur-sm" @click.self="cancelMonthChooser">
              <section class="w-full max-w-[18rem] rounded-2xl border border-white/15 bg-slate-900 p-3 shadow-2xl space-y-3">
                <div class="text-center">
                  <div class="text-xs font-semibold text-slate-100">选择年月</div>
                  <div class="text-[10px] text-slate-500 font-mono">滚动选择后确认</div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div ref="yearColumn" class="relative h-36 overflow-y-auto no-scrollbar rounded-lg border border-white/10 bg-white/5 snap-y snap-mandatory" @scroll="onWheelScroll(yearColumn, yearWheelItems, (value) => (pickerYear = value))">
                    <div :style="{ height: '52px' }" />
                    <button v-for="year in yearWheelItems" :key="year" type="button" class="w-full snap-center font-mono text-sm transition" :style="{ height: ITEM_HEIGHT + 'px' }" :class="pickerYear === year ? 'text-sky-300 font-bold' : 'text-slate-500'" @click="chooseWheel(yearColumn, year, yearWheelItems, (value) => (pickerYear = value))">{{ year }}</button>
                    <div :style="{ height: '52px' }" />
                    <span class="pointer-events-none absolute inset-x-1 top-1/2 h-8 -translate-y-1/2 rounded-md border border-sky-400/30 bg-sky-400/5" />
                  </div>
                  <div ref="monthColumn" class="relative h-36 overflow-y-auto no-scrollbar rounded-lg border border-white/10 bg-white/5 snap-y snap-mandatory" @scroll="onWheelScroll(monthColumn, monthWheelItems, (value) => (pickerMonth = value))">
                    <div :style="{ height: '52px' }" />
                    <button v-for="month in monthWheelItems" :key="month" type="button" class="w-full snap-center font-mono text-sm transition" :style="{ height: ITEM_HEIGHT + 'px' }" :class="pickerMonth === month ? 'text-sky-300 font-bold' : 'text-slate-500'" @click="chooseWheel(monthColumn, month, monthWheelItems, (value) => (pickerMonth = value))">{{ month }}月</button>
                    <div :style="{ height: '52px' }" />
                    <span class="pointer-events-none absolute inset-x-1 top-1/2 h-8 -translate-y-1/2 rounded-md border border-sky-400/30 bg-sky-400/5" />
                  </div>
                </div>
                <div class="flex justify-end gap-2">
                  <button type="button" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs transition" @click="cancelMonthChooser">取消</button>
                  <button type="button" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs transition" @click="confirmMonthChooser">确定</button>
                </div>
              </section>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
