import { reactive } from 'vue'

// 全局 Toast 单例：任意组件 import { useToast } 后调用 success/error/info。
export const toasts = reactive([])
let seed = 0

function dismiss(id) {
  const index = toasts.findIndex((t) => t.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

function push(message, type = 'info', timeout = 2600) {
  const id = (seed += 1)
  toasts.push({ id, message, type })
  if (timeout > 0) {
    setTimeout(() => dismiss(id), timeout)
  }
  return id
}

export function useToast() {
  return {
    toasts,
    push,
    dismiss,
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error', 4500),
    info: (message) => push(message, 'info'),
  }
}

/** 把异步异常统一转成 toast，返回是否成功。 */
export async function runSafe(fn, { error: onError } = {}) {
  const toast = useToast()
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    const message = err?.message || String(err)
    if (onError) onError(err)
    else toast.error(message)
    return { ok: false, error: err }
  }
}
