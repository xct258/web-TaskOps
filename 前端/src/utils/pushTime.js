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
