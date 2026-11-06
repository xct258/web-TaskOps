import { reactive } from 'vue'

// 全局 API 请求计数：首屏用它判断当前页面数据是否已经加载完，
// 数据没回来之前继续盖着加载页，避免进入页面后先空一片再突然出现内容。
export const net = reactive({ pending: 0 })

export function trackRequest(task) {
  net.pending += 1
  return task.finally(() => {
    net.pending = Math.max(0, net.pending - 1)
  })
}
