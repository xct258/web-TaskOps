<script setup>
import { onUnmounted, watch } from 'vue'

import Icon from '@/components/Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  maxWidth: { type: String, default: 'max-w-md' },
  closeOnBackdrop: { type: Boolean, default: true },
  zIndex: { type: Number, default: 50 },
})
const emit = defineEmits(['update:modelValue'])

// 多个弹窗叠加时，Esc 只关闭最上层，避免选择弹窗把下面的详情弹窗一起关掉。
const openModals = []
let modalSeed = 0
const modalId = (modalSeed += 1)

function close() {
  emit('update:modelValue', false)
}

function removeKeydown() {
  window.removeEventListener('keydown', onKeydown)
  const index = openModals.indexOf(modalId)
  if (index >= 0) openModals.splice(index, 1)
}

function onKeydown(e) {
  if (e.key === 'Escape' && openModals[openModals.length - 1] === modalId) close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (!openModals.includes(modalId)) openModals.push(modalId)
      window.addEventListener('keydown', onKeydown)
    } else {
      removeKeydown()
    }
  },
)
onUnmounted(removeKeydown)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md"
        :style="{ zIndex }"
        @click.self="closeOnBackdrop && close()"
      >
        <div
          :class="['w-full bg-slate-900 border border-white/15 rounded-2xl shadow-2xl flex flex-col max-h-[88vh] animate-scale-in', maxWidth]"
        >
          <div class="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <Icon v-if="icon" :name="icon" :size="15" class="shrink-0 text-indigo-400" />
              <h3 class="min-w-0 truncate text-sm font-bold text-white font-mono">{{ title }}</h3>
              <slot name="header-actions" />
            </div>
            <button
              class="shrink-0 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              title="关闭 (Esc)"
              @click="close"
            >
              <Icon name="close" :size="16" />
            </button>
          </div>

          <div class="px-5 py-4 overflow-y-auto custom-scroll flex-1">
            <slot />
          </div>

          <div v-if="$slots.footer" class="px-5 py-3.5 border-t border-white/10 shrink-0">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
