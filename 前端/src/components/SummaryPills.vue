<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { summary } from '@/composables/useSummary'
import { formatCompact } from '@/utils/format'

// 顶部汇总：桌面用胶囊（compact=false），移动端压成一行纯文字，避免撑高顶栏。
const router = useRouter()
const props = defineProps({
  compact: { type: Boolean, default: false },
})

const monitorText = computed(() => {
  if (summary.monitorErrors) return `${summary.monitorErrors}${props.compact ? '' : ' 台'}异常`
  if (summary.monitorWarns) return `${summary.monitorWarns}${props.compact ? '' : ' 台'}告警`
  if (summary.monitorTotal) return `${summary.monitorNormal}/${summary.monitorTotal}${props.compact ? '' : ' '}正常`
  return props.compact ? '无上报' : '暂无上报'
})

const chipBase = 'accent-chip flex shrink-0 items-center whitespace-nowrap rounded-lg transition'
const chipSkin = computed(() =>
  props.compact
    ? 'gap-1 px-1 py-1 leading-none font-mono text-[10px] text-slate-300 active:text-white'
    : 'gap-1 px-2 py-0.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300',
)
</script>

<template>
  <div :class="compact ? 'flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar' : 'contents'">
    <!-- 资产 -->
    <button :class="[chipBase, chipSkin]" title="资金余额 · 前往账本" @click="router.push('/ledger')">
      <span class="text-amber-400 font-bold">¥</span>
      <span>{{ summary.asset == null ? '—' : formatCompact(summary.asset) }}</span>
      <span v-if="summary.liability && !compact" class="text-rose-400 text-[10px]">
        负债 {{ formatCompact(summary.liability) }}
      </span>
    </button>

    <span v-if="compact" class="shrink-0" :style="{ color: 'rgba(var(--wp-accent-rgb), 0.45)' }">·</span>

    <!-- 服务信息 -->
    <button :class="[chipBase, chipSkin]" title="前往服务信息" @click="router.push('/server')">
      <span
        class="h-1.5 w-1.5 rounded-full"
        :class="
          summary.monitorErrors
            ? 'bg-rose-400 animate-pulse'
            : summary.monitorWarns
              ? 'bg-amber-400'
              : summary.monitorTotal
                ? 'bg-emerald-400'
                : 'bg-slate-500'
        "
      />
      <span>{{ monitorText }}</span>
    </button>

    <span v-if="compact" class="shrink-0" :style="{ color: 'rgba(var(--wp-accent-rgb), 0.45)' }">·</span>

    <!-- 待办：有逾期时红色提醒 -->
    <button
      :class="[
        chipBase,
        chipSkin,
        summary.todoOverdue > 0
          ? compact
            ? 'text-rose-300'
            : 'bg-rose-500/15 border-rose-400/50 text-rose-200'
          : '',
      ]"
      title="前往待办"
      @click="router.push('/todos')"
    >
      <span v-if="summary.todoOverdue > 0" class="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
      <span v-else :style="{ color: 'var(--wp-accent)' }">✓</span>
      <span>{{ summary.todoTotal }}/{{ summary.todoOverdue }}{{ compact ? '' : ' ' }}待办</span>
    </button>
  </div>
</template>
