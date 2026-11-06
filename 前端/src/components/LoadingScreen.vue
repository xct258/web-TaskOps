<script setup>
// 首屏加载页：壁纸完全下载并解码完成前一直显示，避免登录页先出现在空背景上。
import { computed } from 'vue'

import { wallpaperProgress } from '@/composables/useWallpaper'

const props = defineProps({
  wallpaperReady: { type: Boolean, default: false },
  authReady: { type: Boolean, default: false },
  contentReady: { type: Boolean, default: false },
})

const known = computed(() => wallpaperProgress.known)
const percent = computed(() => wallpaperProgress.percent)
// 壁纸就绪后进度条切换到「数据加载」的不确定动画。
const wallpaperPhase = computed(() => !props.wallpaperReady)
const barKnown = computed(() => wallpaperPhase.value && known.value)

const phaseText = computed(() => {
  if (wallpaperPhase.value) {
    if (wallpaperProgress.phase === 'decoding') return '正在解码图片…'
    return known.value ? '正在下载壁纸…' : '正在加载壁纸…'
  }
  if (!props.authReady) return '正在验证访问权限…'
  if (!props.contentReady) return '正在同步页面数据…'
  return '准备就绪'
})

const sizeText = computed(() => {
  if (!wallpaperPhase.value) return ''
  if (known.value) {
    return `${formatBytes(wallpaperProgress.loaded)} / ${formatBytes(wallpaperProgress.total)}`
  }
  if (wallpaperProgress.loaded > 0) return `已加载 ${formatBytes(wallpaperProgress.loaded)}`
  return ''
})

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  const digits = value >= 10 || i === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[i]}`
}
</script>

<template>
  <div
    class="loading-screen fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/70"
    role="status"
    aria-live="polite"
    aria-label="正在加载"
  >
    <!-- 背景光晕：跟随壁纸主题色 -->
    <div
      class="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full blur-3xl transition-colors duration-500"
      :style="{ background: 'rgba(var(--wp-accent-rgb), 0.2)' }"
    />
    <div
      class="pointer-events-none absolute -bottom-36 -right-24 h-96 w-96 rounded-full blur-3xl transition-colors duration-500"
      :style="{ background: 'rgba(var(--wp-accent-rgb), 0.12)' }"
    />

    <div class="relative flex w-full max-w-xs flex-col items-center px-6 text-center">
      <!-- 旋转环；已知进度时中心显示百分比 -->
      <div class="relative mb-7 h-16 w-16">
        <div class="absolute inset-0 rounded-full border border-white/10" />
        <div class="loading-ring absolute inset-0 rounded-full border-2 border-transparent" />
        <div class="absolute inset-0 flex items-center justify-center">
          <span
            v-if="barKnown"
            class="font-mono text-[10px] font-semibold tabular-nums"
            :style="{ color: 'var(--wp-accent)' }"
          >
            {{ percent }}%
          </span>
          <span v-else class="loading-core h-2 w-2 rounded-[2px]" />
        </div>
      </div>

      <div class="flex items-center justify-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.5em] text-slate-200">
        <span>TaskOps</span>
        <span class="accent-dot h-1.5 w-1.5 rounded-[2px]" />
      </div>

      <div class="mt-2 flex items-baseline gap-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-500">
        <span>载入控制台</span>
        <span class="loading-dots" aria-hidden="true">
          <span>.</span><span>.</span><span>.</span>
        </span>
      </div>

      <!-- 进度条：有 Content-Length 时显示真实进度，否则来回滚动 -->
      <div class="relative mt-6 h-[3px] w-44 overflow-hidden rounded-full bg-white/10">
        <div
          v-if="barKnown"
          class="loading-progress absolute inset-y-0 left-0 rounded-full"
          :style="{ width: `${percent}%` }"
        />
        <div
          v-else
          class="loading-bar absolute inset-y-0 w-1/3 rounded-full"
        />
      </div>

      <p class="mt-3 text-[10px] tracking-wider text-slate-500">{{ phaseText }}</p>
      <p v-if="sizeText" class="mt-1 font-mono text-[10px] tabular-nums text-slate-600">
        {{ sizeText }}
      </p>
    </div>
  </div>
</template>
