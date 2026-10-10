<script setup>
import { ref } from 'vue'
import { gradientFor, initials, tagColor } from '@/utils/format'

const props = defineProps({ bookmark: { type: Object, required: true } })
const emit = defineEmits(['open', 'ctx'])

const pressTimer = ref(null)
let pressFired = false

function onClick() {
  pressFired = false
  emit('open', props.bookmark)
}

function onCtx(e) {
  e.preventDefault()
  emit('ctx', props.bookmark, e)
}

function onPressStart(e) {
  if (e.touches.length > 1) return
  pressFired = false
  const t = e.touches[0]
  pressTimer.value = setTimeout(() => {
    pressTimer.value = null
    pressFired = true
    try {
      navigator.vibrate?.(30)
    } catch (_) {}
    emit('ctx', props.bookmark, { clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} })
  }, 550)
}

function onPressEnd(e) {
  if (e.type !== 'touchend' && e.type !== 'touchcancel' && e.type !== 'touchmove') return
  if (pressTimer.value) {
    clearTimeout(pressTimer.value)
    pressTimer.value = null
  }
}

function guardClick(e) {
  if (pressFired) {
    e.preventDefault()
    e.stopImmediatePropagation()
    pressFired = false
  }
}
</script>

<template>
  <a
    :href="bookmark.url"
    target="_blank"
    rel="noopener noreferrer"
    class="group/item relative flex items-center gap-2 p-1.5 rounded-xl bg-slate-900/60 hover:bg-slate-900/85 border border-white/10 hover:border-indigo-400/40 transition-all duration-200 overflow-hidden"
    @click.capture="guardClick"
    @click="onClick"
    @contextmenu="onCtx"
    @touchstart.passive="onPressStart"
    @touchmove="onPressEnd"
    @touchend="onPressEnd"
    @touchcancel="onPressEnd"
  >
    <div
      class="w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center text-white font-mono text-[10px] font-bold shadow-md shadow-black/40 flex-shrink-0 group-hover/item:scale-105 transition-transform"
      :class="gradientFor(bookmark.title)"
    >
      {{ initials(bookmark.title) }}
    </div>
    <div class="overflow-hidden flex-1 min-w-0">
      <div
        class="text-[11px] font-semibold text-slate-200 group-hover/item:text-white truncate leading-tight"
        :title="bookmark.title"
      >
        {{ bookmark.title }}
      </div>
      <div class="text-[9px] text-slate-400/90 truncate leading-tight">
        {{ bookmark.description || bookmark.url }}
      </div>
      <div
        v-if="(bookmark.tags || []).length"
        class="flex items-center gap-0.5 mt-0.5 overflow-hidden"
      >
        <span
          v-for="t in bookmark.tags.slice(0, 2)"
          :key="t"
          class="text-[9px] px-1 py-0 rounded-md border whitespace-nowrap truncate"
          :class="tagColor(t)"
        >
          {{ t }}
        </span>
      </div>
    </div>
    <div
      v-if="bookmark.visit_count"
      class="text-[9px] text-slate-500 group-hover/item:text-slate-400 font-mono opacity-0 group-hover/item:opacity-100 transition-opacity"
      :title="`已访问 ${bookmark.visit_count} 次`"
    >
      {{ bookmark.visit_count }}
    </div>
  </a>
</template>

<script>
export default {
  name: 'BookmarkTile',
}
</script>
