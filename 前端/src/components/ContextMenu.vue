<script setup>
import { onMounted, onUnmounted, watch } from 'vue'

import { useContextMenu } from '@/composables/useContextMenu'

const { state, close } = useContextMenu()

// 长按弹菜单后，松手会被浏览器补发一次 click，可能点到遮罩/菜单项导致“一闪即关”。
// 菜单刚打开的一小段时间内，在捕获阶段吞掉第一个 click。
let swallowUntil = 0
function swallowClick(e) {
  if (performance.now() < swallowUntil) {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}

function run(item) {
  close()
  if (!item.disabled) item.action?.()
}

function onKeydown(e) {
  if (e.key === 'Escape' && state.visible) close()
}

function onDismiss() {
  if (state.visible) close()
}

watch(
  () => state.visible,
  (visible) => {
    if (!visible || !state.swallowClick) return
    swallowUntil = performance.now() + 300
    window.addEventListener('click', swallowClick, true)
    setTimeout(() => window.removeEventListener('click', swallowClick, true), 350)
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onDismiss, true)
  window.addEventListener('resize', onDismiss)
  window.addEventListener('blur', onDismiss)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onDismiss, true)
  window.removeEventListener('resize', onDismiss)
  window.removeEventListener('blur', onDismiss)
  window.removeEventListener('click', swallowClick, true)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="state.visible" class="fixed inset-0 z-40" @click="close" @contextmenu.prevent="close" />
    <div
      v-if="state.visible"
      class="fixed z-50 rounded-xl bg-slate-900 border border-white/15 shadow-xl shadow-black/50 p-1 text-xs"
      :style="{ left: `${state.x}px`, top: `${state.y}px`, width: `${state.width}px` }"
    >
      <div v-if="state.title" class="px-2.5 pt-1 pb-0.5 text-[10px] text-slate-500 font-mono truncate">
        {{ state.title }}
      </div>
      <button
        v-for="item in state.items"
        :key="item.key"
        class="w-full text-left px-2.5 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
        :class="item.danger ? 'text-rose-400 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-white/10'"
        :disabled="item.disabled"
        @click="run(item)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>
