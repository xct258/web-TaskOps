<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Icon from '@/components/Icon.vue'
import { loadSummary, summary } from '@/composables/useSummary'
import { refreshWallpaper, wallpaperBusy } from '@/composables/useWallpaper'
import { useWeather } from '@/composables/useWeather'
import { NAV_ITEMS } from '@/router'
import { formatCompact } from '@/utils/format'

const router = useRouter()
const route = useRoute()
const { icon, temp, desc, city } = useWeather()

// 导航高亮：完整类名字面量，确保 Tailwind JIT 能扫描到（原 AppNav 并入顶栏）。
const ACTIVE = {
  indigo: 'bg-indigo-600 text-white border-indigo-400/40 shadow-lg shadow-indigo-500/30',
  sky: 'bg-sky-600 text-white border-sky-400/40 shadow-lg shadow-sky-500/30',
  emerald: 'bg-emerald-600 text-white border-emerald-400/40 shadow-lg shadow-emerald-500/30',
  amber: 'bg-amber-600 text-white border-amber-400/40 shadow-lg shadow-amber-500/30',
  violet: 'bg-violet-600 text-white border-violet-400/40 shadow-lg shadow-violet-500/30',
  rose: 'bg-rose-600 text-white border-rose-400/40 shadow-lg shadow-rose-500/30',
}

onMounted(loadSummary)

function go(path) {
  router.push(path)
}
</script>

<template>
  <header class="flex-shrink-0 flex items-center justify-between gap-3 pb-2.5 border-b border-white/10">
    <!-- Logo + 汇总状态胶囊 -->
    <div class="flex items-center gap-2.5 sm:gap-4 overflow-hidden">
      <!-- 极简排印 Logo：宽字距等宽大写 + 末尾小色块，无装饰图形 -->
      <button
        class="flex items-center gap-1.5 transition-opacity hover:opacity-70"
        title="返回书签首页"
        @click="go('/bookmarks')"
      >
        <h1 class="text-base sm:text-lg font-mono font-bold tracking-[0.3em] text-white leading-none">
          PORTAL
        </h1>
        <span class="h-1.5 w-1.5 rounded-[2px] bg-indigo-400" />
      </button>

      <div class="hidden sm:flex items-center gap-1.5 font-mono text-[11px]">
        <!-- 资产 -->
        <button
          class="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition"
          title="前往账本"
          @click="go('/ledger')"
        >
          <span class="text-amber-400 font-bold">¥</span>
          <span>{{ summary.asset == null ? '—' : formatCompact(summary.asset) }}</span>
          <span v-if="summary.liability" class="text-rose-400 text-[10px]">
            负债 {{ formatCompact(summary.liability) }}
          </span>
        </button>

        <!-- 服务 -->
        <button
          class="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition"
          title="前往服务状态"
          @click="go('/server')"
        >
          <span
            class="h-1.5 w-1.5 rounded-full animate-pulse"
            :class="summary.serverUp > 0 ? 'bg-emerald-400' : 'bg-slate-500'"
          />
          <span>{{ summary.serverUp }}/{{ summary.serverTotal }} 在线</span>
        </button>

        <!-- 待办 -->
        <button
          class="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition"
          title="前往待办"
          @click="go('/todos')"
        >
          <span class="text-sky-400">✓</span>
          <span>{{ summary.todoDone }}/{{ summary.todoTotal }} 待办</span>
          <span v-if="summary.todoOverdue" class="text-rose-400">
            {{ summary.todoOverdue }} 逾期
          </span>
        </button>
      </div>
    </div>

    <!-- 主导航：原 AppNav 整条并入顶栏中间，可横向滚动，省一行高度 -->
    <nav class="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-mono">
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

    <!-- 天气 -->
    <div class="flex items-center gap-2 sm:gap-3.5 font-mono flex-shrink-0">
      <div
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/60 border border-white/10 backdrop-blur-md text-xs"
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

      <button
        class="p-1.5 rounded-xl bg-slate-900/60 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
        title="更换随机壁纸"
        @click="refreshWallpaper"
      >
        <Icon name="refresh" :size="15" :class="{ 'animate-spin': wallpaperBusy }" />
      </button>
    </div>
  </header>
</template>
