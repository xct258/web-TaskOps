import { onUnmounted, ref, watch } from 'vue'

/**
 * 移动端键盘 / 视口适配（登录页和弹窗共用）。
 *
 * 返回值 keyboardInset：键盘实际遮挡的高度。
 * 公式参考 VisualViewport 的通用做法：
 *   inset = layoutHeight - visualViewport.height - visualViewport.offsetTop
 *
 * - 弹窗只把这个值加到自身容器的底部留白上，背景遮罩始终铺满全屏，
 *   不会跟着可视区域一起位移。
 * - 使用 requestAnimationFrame 合并写入，不做长时间防抖，保证跟上键盘动画。
 * - 激活期间锁定页面滚动，避免 iOS 聚焦输入框时把整页拖走。
 * - 用引用计数支持多个弹窗同时打开，最后一个关闭时才恢复页面滚动。
 */
const keyboardInset = ref(0)
let lockCount = 0
let viewport = null
let saved = null
let frame = 0

function measure() {
  if (!viewport) {
    keyboardInset.value = 0
    return
  }
  const layoutHeight = document.documentElement.clientHeight
  const raw = layoutHeight - viewport.height - viewport.offsetTop
  // 缩放时可视区域变小不是键盘造成的；小于 100px 视为地址栏/工具栏变化。
  const next = viewport.scale > 1.01 ? 0 : raw > 100 ? Math.round(raw) : 0
  if (next === keyboardInset.value) return
  keyboardInset.value = next
}

function scheduleMeasure() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

function acquire() {
  if (lockCount === 0) {
    const html = document.documentElement
    const body = document.body
    saved = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    }
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'

    viewport = window.visualViewport
    if (viewport) {
      viewport.addEventListener('resize', scheduleMeasure)
      viewport.addEventListener('scroll', scheduleMeasure)
    }
    window.addEventListener('resize', scheduleMeasure)
    measure()
  }
  lockCount += 1
}

function release() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount > 0) return

  cancelAnimationFrame(frame)
  frame = 0
  if (viewport) {
    viewport.removeEventListener('resize', scheduleMeasure)
    viewport.removeEventListener('scroll', scheduleMeasure)
  }
  window.removeEventListener('resize', scheduleMeasure)
  if (saved) {
    document.documentElement.style.overflow = saved.htmlOverflow
    document.body.style.overflow = saved.bodyOverflow
    document.body.style.overscrollBehavior = saved.bodyOverscroll
    saved = null
  }
  viewport = null
  keyboardInset.value = 0
}

/**
 * @param {() => boolean} active 是否启用键盘适配
 */
export function useKeyboardViewport(active = () => true) {
  let held = false

  watch(
    active,
    (value) => {
      if (value && !held) {
        held = true
        acquire()
      } else if (!value && held) {
        held = false
        release()
      }
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (held) {
      held = false
      release()
    }
  })

  return { keyboardInset }
}
