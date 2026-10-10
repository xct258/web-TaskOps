import { ref } from 'vue'

// 随机壁纸单例：临时换为 picsum。预加载，加载完成再切换，避免闪白。
const BASE = 'https://picsum.photos/1920/1080'

export const wallpaper = ref(`url('${BASE}')`)
export const wallpaperBusy = ref(false)
// 首屏壁纸是否已就绪（加载成功或失败）：App.vue 用它决定何时显示正文
export const wallpaperReady = ref(false)

// 安全兜底：超时后无论成败都放行，页面永不无限等待
const PRELOAD_TIMEOUT_MS = 10000
let preloadStarted = false
let safetyTimer = null

function markReady() {
  if (wallpaperReady.value) return
  wallpaperReady.value = true
  if (safetyTimer) {
    clearTimeout(safetyTimer)
    safetyTimer = null
  }
}

/** 预加载首屏壁纸：onload/onerror 任一触发即放行，另有超时兜底。 */
export function preloadWallpaper() {
  if (preloadStarted) return
  preloadStarted = true
  safetyTimer = setTimeout(markReady, PRELOAD_TIMEOUT_MS)
  const img = new Image()
  img.onload = markReady
  img.onerror = markReady
  img.src = BASE
}

export function refreshWallpaper() {
  if (wallpaperBusy.value) return
  wallpaperBusy.value = true
  const img = new Image()
  img.src = `${BASE}?t=${Date.now()}`
  img.onload = () => {
    wallpaper.value = `url('${img.src}')`
    wallpaperBusy.value = false
  }
  img.onerror = () => {
    wallpaperBusy.value = false
  }
}
