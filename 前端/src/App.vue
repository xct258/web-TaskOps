<script setup>
import { onMounted, onUnmounted } from 'vue'

import AppBackground from '@/components/AppBackground.vue'
import AppHeader from '@/components/AppHeader.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import ToastHost from '@/components/ToastHost.vue'
import { loadSummary } from '@/composables/useSummary'
import { preloadWallpaper, wallpaperReady } from '@/composables/useWallpaper'

let timer = null

onMounted(() => {
  loadSummary()
  preloadWallpaper()
  timer = setInterval(loadSummary, 60000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <AppBackground />

  <!-- 首屏等待：壁纸就绪前只显示加载提示，不显示正文 -->
  <div v-if="!wallpaperReady" class="relative z-10 h-full w-full flex items-center justify-center">
    <div class="text-center font-mono animate-pulse">
      <div class="text-xl font-bold tracking-[0.3em] text-white">主页</div>
      <div class="text-[10px] text-slate-500 tracking-[0.25em] mt-2">LOADING WALLPAPER…</div>
    </div>
  </div>

  <div
    v-else
    class="relative z-10 h-full w-full max-w-7xl mx-auto flex flex-col px-3 sm:px-6 py-2.5 sm:py-3.5 overflow-hidden animate-fade-up"
  >
    <AppHeader />
    <main class="flex-1 min-h-0 overflow-hidden flex flex-col mt-2">
      <router-view v-slot="{ Component }">
        <component :is="Component" class="flex-1 min-h-0" />
      </router-view>
    </main>
  </div>

  <ToastHost />
  <ContextMenu />
</template>
