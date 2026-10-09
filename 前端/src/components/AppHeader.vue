<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import Icon from '@/components/Icon.vue'
import { useClock } from '@/composables/useClock'
import { loadSummary, summary } from '@/composables/useSummary'
import { refreshWallpaper, wallpaperBusy } from '@/composables/useWallpaper'
import { useWeather } from '@/composables/useWeather'
import { formatCompact } from '@/utils/format'

const router = useRouter()
const { time, date } = useClock()
const { icon, temp, desc, city } = useWeather()

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

    <!-- 天气 + 时钟 -->
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

      <div class="text-right flex flex-col justify-center">
        <div class="text-base sm:text-xl font-bold text-white tracking-wider leading-none">{{ time }}</div>
        <div class="text-[9px] text-slate-400 font-medium tracking-wide mt-0.5">{{ date }}</div>
      </div>
    </div>
  </header>
</template>
