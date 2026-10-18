<script setup>
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

const STYLES = {
  success: { icon: 'checkCircle', ring: 'border-emerald-400/40', color: 'text-emerald-400' },
  error: { icon: 'alert', ring: 'border-rose-400/40', color: 'text-rose-400' },
  info: { icon: 'info', ring: 'border-sky-400/40', color: 'text-sky-400' },
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed z-[60] bottom-4 right-4 flex flex-col items-end gap-2 pointer-events-none">
      <TransitionGroup
        enter-active-class="transition-all duration-200"
        leave-active-class="transition-all duration-150"
        enter-from-class="opacity-0 translate-y-2"
        leave-to-class="opacity-0 translate-x-2"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[
            'pointer-events-auto flex items-start gap-2.5 max-w-xs px-3.5 py-2.5 rounded-xl bg-slate-900/95 border shadow-2xl text-xs text-slate-200',
            (STYLES[toast.type] || STYLES.info).ring,
          ]"
          @click="dismiss(toast.id)"
        >
          <Icon
            :name="(STYLES[toast.type] || STYLES.info).icon"
            :size="15"
            :class="['mt-0.5', (STYLES[toast.type] || STYLES.info).color]"
          />
          <span class="selectable leading-relaxed">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
