<script setup>
import { onUnmounted, watch } from 'vue'

import Icon from '@/components/Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  maxWidth: { type: String, default: 'max-w-md' },
  closeOnBackdrop: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])

function close() {
  emit('update:modelValue', false)
}

function onKeydown(e) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
)
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
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
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md"
        @click.self="closeOnBackdrop && close()"
      >
        <div
          :class="['w-full bg-slate-900 border border-white/15 rounded-2xl shadow-2xl flex flex-col max-h-[88vh] animate-scale-in', maxWidth]"
        >
          <div class="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
            <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2 min-w-0">
              <Icon v-if="icon" :name="icon" :size="15" class="text-indigo-400" />
              <span class="truncate">{{ title }}</span>
            </h3>
            <button
              class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
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
