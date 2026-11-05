<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'

import AppBackground from '@/components/AppBackground.vue'
import AppHeader from '@/components/AppHeader.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import ToastHost from '@/components/ToastHost.vue'
import { auth, loadAuth } from '@/composables/useAuth'
import { loadSummary } from '@/composables/useSummary'
import { preloadWallpaper, wallpaperReady } from '@/composables/useWallpaper'

let timer = null

// 登录状态和壁纸都就绪后才离开加载页：避免登录页/主界面先出现在空背景上。
const ready = computed(() => auth.checked && wallpaperReady.value)

function startSummary() {
  loadSummary()
  if (timer) clearInterval(timer)
  timer = setInterval(loadSummary, 60000)
}

onMounted(() => {
  preloadWallpaper()
  loadAuth()
})

watch(
  () => auth.authenticated,
  (authenticated) => {
    if (authenticated) {
      startSummary()
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <AppBackground />

  <!-- 壁纸和登录状态都就绪前保持加载页，避免登录页出现在空背景上 -->
  <div v-if="!ready" class="relative z-10 h-full w-full flex items-center justify-center">
    <div class="text-center font-mono animate-pulse">
      <div class="text-[10px] text-slate-500 tracking-[0.25em]">
        {{ wallpaperReady ? 'CHECKING ACCESS…' : 'LOADING WALLPAPER…' }}
      </div>
    </div>
  </div>

  <LoginScreen v-else-if="!auth.authenticated" />

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
