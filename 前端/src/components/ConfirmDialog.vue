<script setup>
import ModalShell from '@/components/ModalShell.vue'

defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '此操作不可撤销，确定继续吗？' },
  confirmText: { type: String, default: '确认删除' },
  danger: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'confirm'])
</script>

<template>
  <ModalShell
    :model-value="modelValue"
    :title="title"
    icon="alert"
    max-width="max-w-sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="text-xs text-slate-300 selectable leading-relaxed">{{ message }}</p>
    <template #footer>
      <div class="flex justify-end gap-2 text-xs font-mono">
        <button
          class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition"
          @click="emit('update:modelValue', false)"
        >
          取消
        </button>
        <button
          class="px-4 py-1.5 rounded-lg text-white font-medium transition"
          :class="danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </div>
    </template>
  </ModalShell>
</template>
