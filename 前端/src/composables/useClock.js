import { onMounted, onUnmounted, ref } from 'vue'

/** 实时时钟：每秒刷新，样式与模板一致。 */
export function useClock() {
  const time = ref('--:--:--')
  const date = ref('LOADING...')
  let timer = null

  function tick() {
    const now = new Date()
    time.value = now.toLocaleTimeString('zh-CN', { hour12: false })
    date.value = now
      .toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: '2-digit', weekday: 'short' })
      .toUpperCase()
  }

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { time, date }
}
