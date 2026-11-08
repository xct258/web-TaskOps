<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import AppBackground from '@/components/AppBackground.vue'
import AppHeader from '@/components/AppHeader.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import LoadingScreen from '@/components/LoadingScreen.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import ToastHost from '@/components/ToastHost.vue'
import { auth, loadAuth } from '@/composables/useAuth'
import { net } from '@/composables/useNet'
import { preloadModules } from '@/composables/usePreload'
import { loadSummary } from '@/composables/useSummary'
import {
  enterWithoutWallpaper,
  preloadWallpaper,
  wallpaperReady,
  wallpaperTimedOut,
} from '@/composables/useWallpaper'

let timer = null
let idleTimer = null
let deadlineTimer = null
let idleStarted = false

// 数据是否已就绪：登录后等当前页面首批接口返回，避免先空一片再突然出现内容。
const dataReady = ref(false)

// 壁纸、登录状态、页面数据都就绪后才撤掉加载页。
const ready = computed(
  () => auth.checked && wallpaperReady.value && (!auth.authenticated || dataReady.value),
)

// 首屏只加载一次：ready 之后即使登录态/数据状态变化，也不再重新盖加载页，
// 避免偶尔出现「刚进主界面又闪一下加载页、背景像重新加载」。
const bootComplete = ref(false)
watch(
  ready,
  (value) => {
    if (value) bootComplete.value = true
  },
  { immediate: true },
)

const DATA_TIMEOUT_MS = 8000

function clearDataTimers() {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (deadlineTimer) {
    clearTimeout(deadlineTimer)
    deadlineTimer = null
  }
}

function finishData() {
  dataReady.value = true
  clearDataTimers()
}

function waitForData() {
  if (idleStarted) return
  idleStarted = true

  const poll = () => {
    if (net.pending > 0) {
      idleTimer = setTimeout(poll, 80)
      return
    }
    // 静默窗口：防止 mounted 里稍后才发出的请求被漏掉。
    idleTimer = setTimeout(() => {
      if (net.pending > 0) poll()
      else finishData()
    }, 150)
  }

  // 数据接口异常时也不能永远盖着，超时后先放行。
  deadlineTimer = setTimeout(finishData, DATA_TIMEOUT_MS)
  // 等当前路由视图挂载并发出首批请求后再开始轮询。
  nextTick(() => {
    idleTimer = setTimeout(poll, 80)
  })
}

function startSummary() {
  loadSummary()
  if (timer) clearInterval(timer)
  timer = setInterval(loadSummary, 60000)
}

/** 壁纸超时后用户选择「仍然进入」：壁纸和数据等待都直接放行。 */
function enterApp() {
  enterWithoutWallpaper()
  finishData()
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
      preloadModules()
    } else {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      // 退出后下一次登录重新等待首屏数据，避免旧标记让加载页提前消失。
      dataReady.value = false
      idleStarted = false
      clearDataTimers()
    }
  },
  { immediate: true },
)

// 登录状态确认且已登录时，主界面会先挂载在加载页下面并开始拉数据，
// 与壁纸下载并行，数据先回来就先缓存好。
watch(
  [() => auth.checked, () => auth.authenticated],
  ([checked, authenticated]) => {
    if (checked && authenticated) waitForData()
  },
  { immediate: true },
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
  clearDataTimers()
})
</script>

<template>
  <AppBackground />

  <!-- 顶部主题色细线：随壁纸换色，作为全站最轻的强调 -->
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-20 h-px"
    :style="{
      background:
        'linear-gradient(90deg, transparent, rgba(var(--wp-accent-rgb), 0.55), transparent)',
    }"
  />

  <!-- 壁纸、登录状态、页面数据都就绪前保持加载页；就绪后淡出，露出登录页/主界面 -->
  <Transition name="loading-fade">
    <LoadingScreen
      v-if="!bootComplete"
      :wallpaper-ready="wallpaperReady"
      :wallpaper-timed-out="wallpaperTimedOut"
      :auth-ready="auth.checked"
      :content-ready="dataReady"
      @enter="enterApp"
    />
  </Transition>

  <LoginScreen
    v-if="auth.checked && !auth.authenticated"
    :class="ready ? 'visible' : 'invisible'"
  />

  <div
    v-else-if="auth.checked && auth.authenticated"
    class="relative z-10 h-full w-full max-w-7xl mx-auto flex flex-col px-3 sm:px-6 py-2.5 sm:py-3.5 overflow-hidden animate-fade-up"
    :class="bootComplete || ready ? 'visible' : 'invisible'"
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
