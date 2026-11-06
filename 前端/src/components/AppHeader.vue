<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import Icon from '@/components/Icon.vue'
import SummaryPills from '@/components/SummaryPills.vue'
import { loadSummary } from '@/composables/useSummary'
import { useWeather } from '@/composables/useWeather'
import { NAV_ITEMS } from '@/router'

const route = useRoute()
const { icon, temp, desc, city } = useWeather()
const menuOpen = ref(false)
const menuWrap = ref(null)
function toggleMenu() {
  menuOpen.value = !menuOpen.value
}
function closeMenu() {
  menuOpen.value = false
}
function onMenuOutside(e) {
  if (menuOpen.value && menuWrap.value && !menuWrap.value.contains(e.target)) closeMenu()
}
function onMenuKey(e) {
  if (e.key === 'Escape') closeMenu()
}

// 导航高亮：完整类名字面量，确保 Tailwind JIT 能扫描到（原 AppNav 并入顶栏）。
const ACTIVE = {
  indigo: 'bg-indigo-600 text-white border-indigo-400/40',
  sky: 'bg-sky-600 text-white border-sky-400/40',
  emerald: 'bg-emerald-600 text-white border-emerald-400/40',
  amber: 'bg-amber-600 text-white border-amber-400/40',
  violet: 'bg-violet-600 text-white border-violet-400/40',
  rose: 'bg-rose-600 text-white border-rose-400/40',
  teal: 'bg-teal-600 text-white border-teal-400/40',
}

onMounted(() => {
  loadSummary()
  document.addEventListener('click', onMenuOutside)
  document.addEventListener('keydown', onMenuKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onMenuOutside)
  document.removeEventListener('keydown', onMenuKey)
})
</script>

<template>
  <header
    class="flex-shrink-0 flex items-center justify-between gap-2 sm:gap-3 pb-2.5 border-b transition-colors duration-500"
    :style="{ borderBottomColor: 'rgba(var(--wp-accent-rgb), 0.22)' }"
  >
    <!-- 天气：最左侧 -->
    <div
      class="flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/60 border border-white/10 text-xs"
    >
      <span class="text-sm sm:text-base leading-none">{{ icon }}</span>
      <div class="flex flex-col text-left leading-none">
        <div class="flex items-center gap-1">
          <span class="text-xs font-bold text-white">{{ temp }}</span>
          <span class="text-[10px] text-slate-300 hidden xs:inline">{{ desc }}</span>
        </div>
        <span class="text-[9px] text-slate-400 truncate max-w-[68px] mt-0.5">{{ city }}</span>
      </div>
    </div>

    <!-- 右侧：汇总状态 + 导航菜单 -->
    <div class="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3.5">
      <!-- 桌面端汇总状态胶囊 -->
      <div class="hidden sm:flex min-w-0 items-center gap-1.5 font-mono text-[11px] overflow-hidden">
        <SummaryPills />
      </div>

      <!-- 移动端：压缩成一行文字，不额外占高度 -->
      <SummaryPills compact class="sm:hidden min-w-0" />

      <!-- 导航菜单：所有模块收进下拉面板 -->
      <div ref="menuWrap" class="relative flex-shrink-0">
        <button
          class="p-1.5 rounded-xl bg-slate-900/60 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
          title="导航菜单"
          @click="toggleMenu"
        >
          <Icon name="list" :size="15" />
        </button>
        <div
          v-if="menuOpen"
          class="absolute right-0 top-full mt-2 z-50 w-44 rounded-xl bg-slate-900/95 border border-white/10 shadow-2xl p-1.5 space-y-0.5"
        >
          <router-link
            v-for="item in NAV_ITEMS"
            :key="item.name"
            :to="item.path"
            class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-mono whitespace-nowrap border transition-all"
            :class="
              route.name === item.name
                ? `${ACTIVE[item.accent]} border`
                : 'bg-transparent hover:bg-white/10 text-slate-400 hover:text-slate-200 border-transparent'
            "
            @click="closeMenu"
          >
            <Icon :name="item.icon" :size="13" />
            <span>{{ item.title }}</span>
          </router-link>
        </div>
      </div>
    </div>
  </header>
</template>
