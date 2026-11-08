import { reactive, ref } from 'vue'

import { api } from '@/api'

// 随机壁纸单例：图片接口地址由后端 /api/config 提供（环境变量 WALLPAPER_API_URL），
// 默认 https://random-image.xct258.top/。用固定 seed + localStorage 记住，
// 仅用于支持 {seed} 占位符的接口（如 picsum）；直接返回图片的接口每次都会换图。
const DEFAULT_API = 'https://random-image.xct258.top/'
const WIDTH = 1920
const HEIGHT = 1080
const STORAGE_KEY = 'portal-wallpaper-seed'

function loadSeed() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return saved
  } catch (_) {}
  const seed = Math.random().toString(36).slice(2, 10)
  try {
    localStorage.setItem(STORAGE_KEY, seed)
  } catch (_) {}
  return seed
}

let currentSeed = loadSeed()
let apiBase = DEFAULT_API
let currentObjectUrl = ''

// 图片接口返回的主题色 / 对比色：用于给界面加环境色，同时保证文字可读。
export const wallpaperTheme = reactive({
  accent: '',
  accentRgb: '',
  onAccent: '',
  contrast: 0,
  imageId: '',
  apiContrast: 0,
})

const DARK_BG = { r: 2, g: 6, b: 23 }
const WHITE = { r: 248, g: 250, b: 252 }
const DARK_TEXT = { r: 8, g: 15, b: 30 }

function parseColor(value) {
  const text = String(value || '').trim()
  let match = /^#([0-9a-f]{6})$/i.exec(text)
  if (match) {
    const n = parseInt(match[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(text)
  if (match) return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
  return null
}

function toHex({ r, g, b }) {
  const part = (value) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function srgbToLinear(value) {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

function mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

/** 图片主题色可能很暗，逐步混白保证在深色背景上仍然清晰可辨。 */
function readableAccent(color) {
  if (!color) return null
  let result = color
  let t = 0
  while (contrastRatio(result, DARK_BG) < 4.5 && t < 0.9) {
    t += 0.05
    result = mix(color, WHITE, t)
  }
  return result
}

/** 优先用接口给的文字色；对比度不够时按黑/白自动选一个。 */
function onAccentColor(apiColor, accent) {
  if (apiColor && contrastRatio(apiColor, accent) >= 4.5) return apiColor
  return contrastRatio(WHITE, accent) >= contrastRatio(DARK_TEXT, accent) ? WHITE : DARK_TEXT
}

function readTheme(headers) {
  const accent = parseColor(headers.get('x-theme-color-hex')) || parseColor(headers.get('x-theme-color'))
  const text = parseColor(headers.get('x-text-color-hex')) || parseColor(headers.get('x-text-color'))
  return {
    accent,
    text,
    imageId: headers.get('x-image-id') || '',
    apiContrast: Number(headers.get('x-text-contrast')) || 0,
  }
}

function applyTheme(theme) {
  if (!theme) return
  if (theme.imageId) wallpaperTheme.imageId = theme.imageId
  wallpaperTheme.apiContrast = theme.apiContrast || 0

  const accent = readableAccent(theme.accent)
  if (!accent) return
  const onAccent = onAccentColor(theme.text, accent)
  const accentRgb = `${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}`

  wallpaperTheme.accent = toHex(accent)
  wallpaperTheme.accentRgb = accentRgb
  wallpaperTheme.onAccent = toHex(onAccent)
  wallpaperTheme.contrast = contrastRatio(accent, DARK_BG)

  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.style.setProperty('--wp-accent', wallpaperTheme.accent)
    root.style.setProperty('--wp-accent-rgb', accentRgb)
    root.style.setProperty('--wp-on-accent', wallpaperTheme.onAccent)
    root.style.setProperty('--wp-contrast', wallpaperTheme.contrast.toFixed(2))
    if (theme.imageId) root.dataset.wallpaperId = theme.imageId
  }
}

// 首屏壁纸下载进度：known=false 表示服务端没给 Content-Length，用不确定进度条。
export const wallpaperProgress = reactive({
  phase: 'loading', // loading | decoding
  loaded: 0,
  total: 0,
  known: false,
  percent: 0,
})

let lastProgressUpdate = 0

function resetProgress() {
  wallpaperProgress.phase = 'loading'
  wallpaperProgress.loaded = 0
  wallpaperProgress.total = 0
  wallpaperProgress.known = false
  wallpaperProgress.percent = 0
  lastProgressUpdate = 0
}

function updateProgress(loaded, total, force = false) {
  // 大图会切成很多块，节流到约 10 次/秒，避免进度刷新本身造成卡顿。
  const now = Date.now()
  if (!force && now - lastProgressUpdate < 80) return
  lastProgressUpdate = now

  wallpaperProgress.loaded = loaded
  wallpaperProgress.total = total
  wallpaperProgress.known = total > 0
  // 100% 留给解码完成，避免进度先满了图还没出来。
  wallpaperProgress.percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0
}

/**
 * 生成壁纸地址。
 * - 带占位符时按模板替换：{seed} / {width} / {height}
 * - 没有占位符时视为直接返回图片的接口，原样使用
 */
function buildUrl(seed, { bust = false } = {}) {
  let url = apiBase.includes('{')
    ? apiBase
        .replaceAll('{seed}', encodeURIComponent(seed))
        .replaceAll('{width}', String(WIDTH))
        .replaceAll('{height}', String(HEIGHT))
    : apiBase
  // 刷新时加时间戳避免缓存；直接返回图片的接口再用 exclude 避开上一张。
  if (bust) {
    const params = []
    if (!apiBase.includes('{') && wallpaperTheme.imageId) {
      params.push(`exclude=${encodeURIComponent(wallpaperTheme.imageId)}`)
    }
    params.push(`_=${Date.now()}`)
    url += `${url.includes('?') ? '&' : '?'}${params.join('&')}`
  }
  return url
}

function revoke(url) {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * 把远程图片取成 blob URL：预加载和背景使用同一个地址，
 * 避免 direct 接口被请求两次，出现“加载完的是 A、显示的是 B”。
 * 接口不允许 CORS 时退回原地址，仍由 <img> 正常加载。
 */
async function toDisplayUrl(url, onProgress, onTheme) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (type && !type.startsWith('image/')) throw new Error('not an image')

    // 主题色在响应头里，先拿到就能给加载页换色；不等整张图下载完。
    const theme = readTheme(res.headers)
    if (theme.accent || theme.imageId) onTheme?.(theme)

    const total = Number(res.headers.get('content-length')) || 0
    let blob
    if (res.body && typeof res.body.getReader === 'function') {
      // 流式读取，边下边更新进度。
      const reader = res.body.getReader()
      const chunks = []
      let loaded = 0
      onProgress?.(loaded, total)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue
        chunks.push(value)
        loaded += value.byteLength
        onProgress?.(loaded, total)
      }
      // 保证最后一块的进度一定落库。
      onProgress?.(loaded, total, true)
      blob = new Blob(chunks, { type: type || 'image/jpeg' })
    } else {
      blob = await res.blob()
      onProgress?.(blob.size, blob.size)
    }

    if (!blob.size) throw new Error('empty image')
    return { url: URL.createObjectURL(blob), theme }
  } catch (_) {
    return { url, theme: null }
  }
}

/** 等图片真正下载并解码完成，onload 之后可能还需要 decode 才能立刻绘制。 */
function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') await img.decode()
      } catch (_) {
        // 部分浏览器对已加载图片 decode 会 reject，此时图片仍可显示。
      }
      resolve(img)
    }
    img.onerror = () => reject(new Error(`壁纸加载失败：${src}`))
    img.src = src
  })
}

export const wallpaper = ref('')
// 顶层新图：预加载完成后先铺在上层（透明），再淡入到不透明，实现交叉过渡。
export const wallpaperNext = ref('')
export const wallpaperFading = ref(false)
export const wallpaperBusy = ref(false)
// 淡入时长（ms），与 AppBackground 的 duration-1000 对应。
export const WALLPAPER_FADE_MS = 1000
let fadeTimer = null
// 首屏壁纸是否已就绪（加载成功或用户选择跳过）：App.vue 用它决定何时显示正文
export const wallpaperReady = ref(false)

// 壁纸超过等待时间：不自动进界面，由用户在加载页上选择「继续等待」或「仍然进入」。
export const wallpaperTimedOut = ref(false)

// 超时后只弹选择，不再自动放行；用户点击「仍然进入」才会 markReady。
const PRELOAD_TIMEOUT_MS = 15000
let preloadStarted = false
let safetyTimer = null

function armSafetyTimer() {
  if (safetyTimer) {
    clearTimeout(safetyTimer)
    safetyTimer = null
  }
  safetyTimer = setTimeout(() => {
    safetyTimer = null
    if (!wallpaperReady.value) {
      wallpaperTimedOut.value = true
    }
  }, PRELOAD_TIMEOUT_MS)
}

function markReady(force = false) {
  if (wallpaperReady.value) return
  // 超时后必须等用户明确选择，避免图片还没出来就自动进入主界面。
  if (wallpaperTimedOut.value && !force) return
  wallpaperReady.value = true
  wallpaperTimedOut.value = false
  if (safetyTimer) {
    clearTimeout(safetyTimer)
    safetyTimer = null
  }
}

/** 用户选择「仍然进入」：不等壁纸了，直接放行。 */
export function enterWithoutWallpaper() {
  markReady(true)
  if (safetyTimer) {
    clearTimeout(safetyTimer)
    safetyTimer = null
  }
}

/** 预加载首屏壁纸：先取运行时配置，等图片下载并解码完成后再放行登录页。 */
export async function preloadWallpaper() {
  if (preloadStarted) return
  preloadStarted = true
  armSafetyTimer()

  try {
    const config = await api.config.get()
    const configured = String(config?.wallpaperApiUrl || '').trim()
    if (configured) apiBase = configured
  } catch (_) {
    // 配置接口不可用时继续用默认地址，不阻塞页面。
  }

  let displayUrl = ''
  resetProgress()
  try {
    const loaded = await toDisplayUrl(buildUrl(currentSeed), updateProgress, applyTheme)
    displayUrl = loaded.url
    applyTheme(loaded.theme)

    if (displayUrl && !/^https?:/i.test(displayUrl)) {
      // fetch 成功时是 blob/data URL，可以真正做到「先解码再显示」。
      wallpaperProgress.phase = 'decoding'
      await decodeImage(displayUrl)
      currentObjectUrl = displayUrl
      wallpaper.value = `url("${displayUrl}")`
    } else if (displayUrl) {
      // fetch 失败（通常是接口不允许 CORS）时退回原始地址。
      // 这里只让背景层加载一次；不要再 new Image 预加载，否则每次请求都随机换一张图，
      // 会出现「加载页结束后背景又变了一张」的现象。
      wallpaperProgress.phase = 'decoding'
      wallpaper.value = `url("${displayUrl}")`
      await new Promise((resolve) => setTimeout(resolve, 120))
    }

    wallpaperProgress.phase = 'ready'
    wallpaperProgress.percent = 100
  } catch (_) {
    // 壁纸加载失败时不把用户卡在加载页；已创建的 blob 顺手释放，背景保持暗色。
    revoke(displayUrl)
  } finally {
    markReady()
  }
}

export async function refreshWallpaper() {
  if (wallpaperBusy.value) return
  wallpaperBusy.value = true

  const nextSeed = Math.random().toString(36).slice(2, 10)
  let displayUrl = ''
  try {
    const loaded = await toDisplayUrl(buildUrl(nextSeed, { bust: true }))
    displayUrl = loaded.url
    // 只有 blob/data URL 才做独立解码；远程地址交给背景层加载一次，
    // 避免随机图接口被请求两次后变成另一张图。
    if (!/^https?:/i.test(displayUrl)) {
      await decodeImage(displayUrl)
    }
    // 新图解码完成后，再让界面主题色跟着一起切换。
    applyTheme(loaded.theme)
  } catch (_) {
    revoke(displayUrl)
    wallpaperBusy.value = false
    return
  }

  const previousObjectUrl = currentObjectUrl
  currentSeed = nextSeed
  try {
    localStorage.setItem(STORAGE_KEY, nextSeed)
  } catch (_) {}
  currentObjectUrl = displayUrl

  // 先把新图铺到顶层（opacity-0），下一拍再淡入，触发 transition。
  wallpaperNext.value = `url("${displayUrl}")`
  wallpaperFading.value = false
  setTimeout(() => {
    wallpaperFading.value = true
  }, 50)
  // 淡入完成后：底层换成新图，顶层清空复位，并释放旧图。
  if (fadeTimer) clearTimeout(fadeTimer)
  fadeTimer = setTimeout(() => {
    wallpaper.value = wallpaperNext.value
    wallpaperNext.value = ''
    wallpaperFading.value = false
    wallpaperBusy.value = false
    revoke(previousObjectUrl)
  }, 50 + WALLPAPER_FADE_MS + 150)
}
