import { onMounted, ref } from 'vue'

/** WMO 天气代码 -> 图标 + 中文描述（与模板保持一致）。 */
export function decodeWMO(code) {
  if (code === 0) return { icon: '☀️', text: '晴朗' }
  if ([1, 2].includes(code)) return { icon: '🌤️', text: '多云' }
  if (code === 3) return { icon: '☁️', text: '阴天' }
  if ([45, 48].includes(code)) return { icon: '🌫️', text: '大雾' }
  if ([51, 53, 55, 61, 63].includes(code)) return { icon: '🌧️', text: '小雨' }
  if ([65, 80, 81, 82].includes(code)) return { icon: '🌧️', text: '中雨' }
  if ([71, 73, 75, 85].includes(code)) return { icon: '❄️', text: '降雪' }
  if ([95, 96, 99].includes(code)) return { icon: '⛈️', text: '雷雨' }
  return { icon: '⛅', text: '多云' }
}

const FALLBACK = { lat: 30.5928, lon: 114.3055, label: '武汉' }

/** 免 Key 天气：默认武汉，不获取浏览器定位。 */
export function useWeather() {
  const icon = ref('🌤️')
  const temp = ref('--°C')
  const desc = ref('')
  const city = ref('武汉')
  const loading = ref(false)

  async function load(lat, lon, label) {
    loading.value = true
    city.value = label
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
      )
      if (!res.ok) throw new Error('weather api failed')
      const data = await res.json()
      const cw = data?.current_weather
      if (cw) {
        const status = decodeWMO(cw.weathercode)
        icon.value = status.icon
        temp.value = `${Math.round(cw.temperature)}°C`
        desc.value = status.text
      }
    } catch {
      desc.value = '离线'
    } finally {
      loading.value = false
    }
  }

  function locate() {
    load(FALLBACK.lat, FALLBACK.lon, FALLBACK.label)
  }

  onMounted(locate)

  return { icon, temp, desc, city, loading, refresh: locate }
}
