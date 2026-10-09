<script setup>
import { useRoute } from 'vue-router'

import Icon from '@/components/Icon.vue'
import { NAV_ITEMS } from '@/router'

const route = useRoute()

// 完整类名字面量，确保 Tailwind JIT 能扫描到。
const ACTIVE = {
  indigo: 'bg-indigo-600 text-white border-indigo-400/40 shadow-lg shadow-indigo-500/30',
  sky: 'bg-sky-600 text-white border-sky-400/40 shadow-lg shadow-sky-500/30',
  emerald: 'bg-emerald-600 text-white border-emerald-400/40 shadow-lg shadow-emerald-500/30',
  amber: 'bg-amber-600 text-white border-amber-400/40 shadow-lg shadow-amber-500/30',
  violet: 'bg-violet-600 text-white border-violet-400/40 shadow-lg shadow-violet-500/30',
  rose: 'bg-rose-600 text-white border-rose-400/40 shadow-lg shadow-rose-500/30',
}
</script>

<template>
  <nav class="flex-shrink-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-mono">
    <router-link
      v-for="item in NAV_ITEMS"
      :key="item.name"
      :to="item.path"
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap border transition-all"
      :class="
        route.name === item.name
          ? `${ACTIVE[item.accent]} font-bold`
          : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5'
      "
    >
      <Icon :name="item.icon" :size="13" />
      <span>{{ item.title }}</span>
    </router-link>
  </nav>
</template>
