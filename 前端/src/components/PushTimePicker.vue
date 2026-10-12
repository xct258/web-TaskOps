<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import {
  beijingTodayYMD,
  formatPush,
  parsePushInput,
  pushRelative,
  shiftYMD,
  ymdWeekday,
} from '@/utils/pushTime'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const draftDate = ref('')
const draftHour = ref('')
const draftMinute = ref('')

const ITEM_H = 36
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_IDX = { 周一: 0, 周二: 1, 周三: 2, 周四: 3, 周五: 4, 周六: 5, 周日: 6 }
const pad = (n) => String(n).padStart(2, '0')

const hourCol = ref(null)
const minuteCol = ref(null)
let programScroll = 0

// 月历视图年月（周一起始）。
const viewY = ref(0)
const viewM = ref(0)

/** 面板内草稿拼出的值（北京时间墙钟）。 */
const draftValue = computed(() =>
  draftDate.value && draftHour.value !== '' && draftMinute.value !== ''
    ? `${draftDate.value}T${draftHour.value}:${draftMinute.value}`
    : '',
)
const draftRelative = computed(() => pushRelative(draftValue.value))
const displayText = computed(() => {
  const p = parsePushInput(props.modelValue)
  if (!p) return ''
  return `${formatPush(props.modelValue)} ${ymdWeekday(p.date)}`
})
const displayRelative = computed(() => pushRelative(props.modelValue))

const todayYMD = computed(() => beijingTodayYMD())
const monthLabel = computed(() => `${viewY.value}年${viewM.value}月`)

/** 当月格子：前导空白 + 日期（周一起始）。 */
const calendarCells = computed(() => {
  if (!viewY.value || !viewM.value) return []
  const first = ymdWeekday(`${viewY.value}-${pad(viewM.value)}-01`)
  const offset = WEEK_IDX[first] ?? 0
  const days = new Date(Date.UTC(viewY.value, viewM.value, 0)).getUTCDate()
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= days; d++) {
    const date = `${viewY.value}-${pad(viewM.value)}-${pad(d)}`
    cells.push({ date, day: d, isToday: date === todayYMD.value, past: date < todayYMD.value })
  }
  return cells
})

function dayCls(c) {
  if (draftDate.value === c.date) return 'bg-sky-600 text-white font-bold'
  let cls = 'text-slate-300 hover:bg-white/10'
  if (c.isToday) cls += ' ring-1 ring-sky-400/60 text-sky-200'
  else if (c.past) cls += ' text-slate-600'
  return cls
}

function setView(ymd) {
  const [y, m] = String(ymd).split('-').map(Number)
  if (!y || !m) return
  viewY.value = y
  viewM.value = m
}

function prevMonth() {
  let y = viewY.value
  let m = viewM.value - 1
  if (m < 1) {
    m = 12
    y -= 1
  }
  viewY.value = y
  viewM.value = m
}

function nextMonth() {
  let y = viewY.value
  let m = viewM.value + 1
  if (m > 12) {
    m = 1
    y += 1
  }
  viewY.value = y
  viewM.value = m
}

function beijingNowRounded() {
  const now = new Date(Date.now() + 8 * 3600e3)
  const total = now.getUTCHours() * 60 + now.getUTCMinutes()
  const rounded = Math.ceil((total + 1) / 5) * 5
  const date = shiftYMD(beijingTodayYMD(), Math.floor(rounded / 1440))
  const mins = rounded % 1440
  return {
    date,
    hour: String(Math.floor(mins / 60)).padStart(2, '0'),
    minute: String(mins % 60).padStart(2, '0'),
  }
}

function scrollColTo(el, value, items) {
  if (!el) return
  const idx = items.indexOf(value)
  if (idx < 0) return
  programScroll += 1
  el.scrollTo({ top: idx * ITEM_H })
  setTimeout(() => {
    programScroll = Math.max(0, programScroll - 1)
  }, 150)
}

function syncColumns() {
  scrollColTo(hourCol.value, draftHour.value, hours)
  scrollColTo(minuteCol.value, draftMinute.value, minutes)
}

function toggle() {
  open.value = !open.value
  if (!open.value) return
  const p = parsePushInput(props.modelValue)
  const init = p || beijingNowRounded()
  draftDate.value = init.date
  draftHour.value = init.hour
  draftMinute.value = init.minute
  setView(init.date)
  nextTick(syncColumns)
}

function confirm() {
  if (!draftValue.value) return
  emit('update:modelValue', draftValue.value)
  open.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape') open.value = false
}

watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function onColumnScroll(el, items, set) {
  if (programScroll > 0 || !el) return
  clearTimeout(el._t)
  el._t = setTimeout(() => {
    const idx = Math.round(el.scrollTop / ITEM_H)
    set(items[Math.max(0, Math.min(items.length - 1, idx))])
  }, 120)
}

function pickFromColumn(el, value, items) {
  scrollColTo(el, value, items)
}
</script>

<template>
  <div>
    <button
      type="button"
      class="w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs flex items-center justify-between gap-2 hover:border-sky-400/50 transition"
      :class="modelValue ? 'text-white' : 'text-slate-500'"
      @click="toggle"
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
          @click.self="open = false"
        >
          <div class="w-full max-w-sm bg-slate-900 border border-white/15 rounded-2xl shadow-2xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <button
                type="button"
                title="上个月"
                class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition"
                @click="prevMonth"
              >
                ‹
              </button>
              <span class="text-xs font-mono text-slate-200">{{ monthLabel }}</span>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  class="px-2 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sky-300 text-[11px] font-mono transition"
                  @click="setView(todayYMD)"
                >
                  今天
                </button>
                <button
                  type="button"
                  title="下个月"
                  class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition"
                  @click="nextMonth"
                >
                  ›
                </button>
              </div>
            </div>

            <div>
              <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-mono text-slate-500 mb-1">
                <span v-for="w in WEEK_HEAD" :key="w">{{ w }}</span>
              </div>
              <div class="grid grid-cols-7 gap-1">
                <template v-for="(c, i) in calendarCells" :key="i">
                  <span v-if="!c" />
                  <button
                    v-else
                    type="button"
                    class="h-9 rounded-lg text-xs font-mono transition"
                    :class="dayCls(c)"
                    @click="draftDate = c.date"
                  >
                    {{ c.day }}
                  </button>
                </template>
              </div>
            </div>

            <div class="flex gap-2">
              <div class="flex-1">
                <div class="text-[10px] text-slate-500 font-mono text-center mb-1">时</div>
                <div
                  ref="hourCol"
                  class="h-36 overflow-y-auto no-scrollbar rounded-lg bg-white/5 border border-white/10 snap-y snap-mandatory"
                  @scroll="onColumnScroll(hourCol, hours, (v) => (draftHour = v))"
                >
                  <div :style="{ height: '54px' }" />
                  <button
                    v-for="h in hours"
                    :key="h"
                    type="button"
                    class="w-full font-mono text-sm snap-center transition"
                    :style="{ height: ITEM_H + 'px' }"
                    :class="draftHour === h ? 'text-sky-300 font-bold' : 'text-slate-400'"
                    @click="pickFromColumn(hourCol, h, hours)"
                  >
                    {{ h }}
                  </button>
                  <div :style="{ height: '54px' }" />
                </div>
              </div>
              <div class="flex-1">
                <div class="text-[10px] text-slate-500 font-mono text-center mb-1">分</div>
                <div
                  ref="minuteCol"
                  class="h-36 overflow-y-auto no-scrollbar rounded-lg bg-white/5 border border-white/10 snap-y snap-mandatory"
                  @scroll="onColumnScroll(minuteCol, minutes, (v) => (draftMinute = v))"
                >
                  <div :style="{ height: '54px' }" />
                  <button
                    v-for="m in minutes"
                    :key="m"
                    type="button"
                    class="w-full font-mono text-sm snap-center transition"
                    :style="{ height: ITEM_H + 'px' }"
                    :class="draftMinute === m ? 'text-sky-300 font-bold' : 'text-slate-400'"
                    @click="pickFromColumn(minuteCol, m, minutes)"
                  >
                    {{ m }}
                  </button>
                  <div :style="{ height: '54px' }" />
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-mono text-slate-400">
                {{ draftValue ? `${draftValue.slice(5).replace('T', ' ')} ${ymdWeekday(draftDate)} · ${draftRelative}` : '' }}
              </span>
              <div class="flex gap-2 shrink-0">
                <button
                  type="button"
                  class="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs transition"
                  @click="open = false"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs transition"
                  @click="confirm"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
