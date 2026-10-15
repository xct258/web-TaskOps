<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

import DatePicker from '@/components/DatePicker.vue'
import { beijingTodayYMD, formatPush, joinPushInput, parsePushInput, pushRelative, shiftYMD } from '@/utils/pushTime'

const props = defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const draftDate = ref('')
const draftHour = ref('')
const draftMinute = ref('')
const pad = (value) => String(value).padStart(2, '0')
const validTime = computed(() => /^\d{1,2}$/.test(String(draftHour.value)) && /^\d{1,2}$/.test(String(draftMinute.value)) && Number(draftHour.value) < 24 && Number(draftMinute.value) < 60)

const draftValue = computed(() => validTime.value ? joinPushInput(draftDate.value, pad(draftHour.value), pad(draftMinute.value)) : '')
const displayParts = computed(() => parsePushInput(props.modelValue))
const displayText = computed(() => (displayParts.value ? `${formatPush(props.modelValue)} · 北京时间` : ''))
const displayRelative = computed(() => pushRelative(props.modelValue))

function roundedNow() {
  const now = new Date(Date.now() + 8 * 3600e3)
  const total = now.getUTCHours() * 60 + now.getUTCMinutes()
  const rounded = Math.ceil((total + 1) / 5) * 5
  const date = shiftYMD(beijingTodayYMD(), Math.floor(rounded / 1440))
  const minutes = rounded % 1440
  return { date, hour: String(Math.floor(minutes / 60)).padStart(2, '0'), minute: String(minutes % 60).padStart(2, '0') }
}

function openPicker() {
  const parsed = parsePushInput(props.modelValue)
  const initial = parsed || roundedNow()
  draftDate.value = initial.date
  draftHour.value = initial.hour
  draftMinute.value = initial.minute
  open.value = true
}

function adjustTime(field, delta) {
  const target = field === 'hour' ? draftHour : draftMinute
  const limit = field === 'hour' ? 24 : 60
  target.value = pad(((Number(target.value) || 0) + delta + limit) % limit)
}

function normalizeTime(field) {
  const target = field === 'hour' ? draftHour : draftMinute
  if (/^\d{1,2}$/.test(String(target.value))) target.value = pad(target.value)
}

function confirm() {
  if (!draftValue.value) return
  emit('update:modelValue', draftValue.value)
  open.value = false
}

function clearTime() {
  emit('update:modelValue', '')
  open.value = false
}

function onKeydown(event) {
  if (document.querySelector('[data-date-picker-dialog]')) return
  if (open.value && event.key === 'Escape') {
    event.stopImmediatePropagation()
    open.value = false
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown, true))
onUnmounted(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs flex items-center justify-between gap-2 hover:border-sky-400/50 transition"
      :class="modelValue ? 'text-white' : 'text-slate-500'"
      @click="open ? (open = false) : openPicker()"
    >
      <span>{{ displayText || '选择推送时间' }}</span>
      <span v-if="displayRelative" class="text-sky-400 font-mono text-[11px] shrink-0">{{ displayRelative }}</span>
    </button>

    <Teleport to="body">
    <Transition enter-active-class="transition duration-150" leave-active-class="transition duration-100" enter-from-class="opacity-0" leave-to-class="opacity-0">
      <div v-if="open" class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm" @click.self="open = false">
      <section role="dialog" aria-modal="true" aria-label="选择推送时间" class="w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-4 shadow-2xl shadow-slate-950/50">
        <h3 class="text-sm font-semibold text-white mb-4">选择推送时间 <span class="text-xs font-normal text-slate-500">北京时间</span></h3>
        <div class="text-[10px] text-slate-500 mb-1.5">日期</div>
        <DatePicker v-model="draftDate" placeholder="选择日期" />
        <div class="flex items-center justify-center gap-3 mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <div v-for="field in ['hour', 'minute']" :key="field" class="flex items-center gap-3">
            <span v-if="field === 'minute'" class="text-2xl text-slate-600 font-mono">:</span>
            <div class="flex flex-col items-center gap-1">
              <button type="button" class="w-20 py-1 rounded-lg text-slate-400 hover:bg-white/10 hover:text-sky-300" :aria-label="field === 'hour' ? '增加小时' : '增加分钟'" @click="adjustTime(field, 1)">⌃</button>
              <input :value="field === 'hour' ? draftHour : draftMinute" type="text" inputmode="numeric" maxlength="2" :aria-label="field === 'hour' ? '小时' : '分钟'" class="w-20 py-2 rounded-xl border border-white/10 bg-slate-900 text-center text-3xl font-mono text-white focus:outline-none focus:border-sky-400" @input="field === 'hour' ? (draftHour = $event.target.value) : (draftMinute = $event.target.value)" @blur="normalizeTime(field)" @keydown.up.prevent="adjustTime(field, 1)" @keydown.down.prevent="adjustTime(field, -1)" @focus="$event.target.select()" />
              <button type="button" class="w-20 py-1 rounded-lg text-slate-400 hover:bg-white/10 hover:text-sky-300" :aria-label="field === 'hour' ? '减少小时' : '减少分钟'" @click="adjustTime(field, -1)">⌄</button>
              <span class="text-[10px] text-slate-500">{{ field === 'hour' ? '小时 · 00–23' : '分钟 · 00–59' }}</span>
            </div>
          </div>
        </div>
        <p class="mt-3 text-center text-xs" :class="draftValue ? 'text-sky-300' : 'text-rose-300'">{{ draftValue ? `${draftDate} ${pad(draftHour)}:${pad(draftMinute)} · ${pushRelative(draftValue)}` : '请选择日期，并输入有效的小时和分钟' }}</p>
        <div class="flex justify-end gap-2 mt-3 pt-2 border-t border-white/10">
          <button type="button" class="px-3 py-1.5 rounded-lg text-xs text-rose-300 hover:bg-rose-500/10 transition" @click="clearTime">清除时间</button>
          <button type="button" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs transition" @click="open = false">取消</button>
          <button type="button" class="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs transition disabled:opacity-40 disabled:cursor-not-allowed" :disabled="!draftValue" @click="confirm">确定</button>
        </div>
      </section>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>
