<script setup>
import Icon from '@/components/Icon.vue'

defineProps({
  icon: { type: String, default: 'search' },
  title: { type: String, default: '暂无数据' },
  description: { type: String, default: '' },
})
</script>

<template>
  <div class="h-full min-h-[13rem] flex flex-col items-center justify-center text-center gap-2 font-mono text-xs text-slate-500">
    <Icon :name="icon" :size="30" class="opacity-50" />
    <div class="text-slate-400">{{ title }}</div>
    <div v-if="description" class="text-[11px] text-slate-600 max-w-xs">{{ description }}</div>
    <slot />
  </div>
</template>
