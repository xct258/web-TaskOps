<script setup>
import Icon from '@/components/Icon.vue'

defineProps({
  icon: { type: String, default: 'search' },
  title: { type: String, default: '暂无数据' },
  description: { type: String, default: '' },
  // 为 true 时相对页面根节点绝对居中（要求页面根有 relative），而不是在滚动区域内居中；
  // 穿透点击，不挡住工具条。
  overlay: { type: Boolean, default: false },
})
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center gap-2 font-mono text-xs text-slate-500"
    :class="overlay ? 'absolute inset-0 z-10 pointer-events-none' : 'h-full min-h-[13rem]'"
  >
    <Icon :name="icon" :size="30" class="opacity-50" />
    <div class="text-slate-400">{{ title }}</div>
    <div v-if="description" class="text-[11px] text-slate-600 max-w-xs">{{ description }}</div>
    <slot />
  </div>
</template>
