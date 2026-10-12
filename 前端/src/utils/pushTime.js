// MQTT 排期统一使用北京时间，与后端 Asia/Shanghai 的约定一致。
const pushTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** API 时间 → 北京时间的 datetime-local 值，兼容旧接口的无时区时间。 */
export function toPushInput(value) {
  if (!value) return ''
  let text = String(value).trim().replace(' ', 'T')
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += '+08:00'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(pushTimeFormatter.formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** 输入框中的北京时间 → 带明确时区的 API 时间。 */
export function toPushISO(value) {
  const input = toPushInput(value)
  return input ? `${input}:00+08:00` : ''
}

export function formatPush(value) {
  const input = toPushInput(value)
  return input ? `${input.slice(5, 10)} ${input.slice(11)}` : ''
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_MS = 86400000
// 北京时间正午对应 UTC 04:00，以此锚定做日期推算（中国无夏令时，+8 固定）。
const pad2 = (n) => String(n).padStart(2, '0')

function ymdFromUtcMs(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** 北京时间今天（YYYY-MM-DD），与浏览器时区无关。 */
export function beijingTodayYMD(nowMs = Date.now()) {
  return ymdFromUtcMs(nowMs + 8 * 3600e3)
}

/** 日期平移 n 天（输入/输出均为 YYYY-MM-DD）。 */
export function shiftYMD(ymd, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return ''
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], 4)
  if (Number.isNaN(ms)) return ''
  return ymdFromUtcMs(ms + n * DAY_MS)
}

/** YYYY-MM-DD → 周几；非法返回空。 */
export function ymdWeekday(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return ''
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], 4)
  if (Number.isNaN(ms)) return ''
  return WEEKDAYS[new Date(ms).getUTCDay()]
}

/** 解析选择器值 → {date, hour, minute}，非法返回 null。 */
export function parsePushInput(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(toPushInput(value))
  if (!m) return null
  return { date: m[1], hour: m[2], minute: m[3] }
}

/** 选择器值拼回 'YYYY-MM-DDTHH:MM'，非法返回空。 */
export function joinPushInput(date, hour, minute) {
  const d = parsePushInput(`${date}T${hour}:${minute}`)
  return d ? `${d.date}T${d.hour}:${d.minute}` : ''
}

/** 相对当前时间的提示，如“约2小时后”“约3天后”“已过去”；空值返回空。 */
export function pushRelative(value, nowMs = Date.now()) {
  const p = parsePushInput(value)
  if (!p) return ''
  const [y, mo, d] = p.date.split('-').map(Number)
  const target = Date.UTC(y, mo - 1, d, +p.hour, +p.minute) - 8 * 3600e3
  const diff = target - nowMs
  if (diff <= 0) return '已过去'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `约${mins}分钟后`
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    const rest = mins % 60
    return rest ? `约${hours}小时${rest}分钟后` : `约${hours}小时后`
  }
  const days = Math.floor(hours / 24)
  const restH = hours % 24
  return restH ? `约${days}天${restH}小时后` : `约${days}天后`
}
