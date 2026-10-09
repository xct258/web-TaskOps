// 通用格式化与展示元数据。注意：Tailwind 类名必须写成完整字符串字面量，
// 否则 JIT 扫描不到、构建后样式会丢。

/* --------------------------- 渐变配色 --------------------------- */
export const GRADIENTS = [
  'from-indigo-600 to-blue-600',
  'from-violet-600 to-indigo-600',
  'from-sky-600 to-blue-700',
  'from-cyan-600 to-blue-600',
  'from-teal-600 to-emerald-600',
  'from-emerald-600 to-green-600',
  'from-amber-600 to-orange-600',
  'from-orange-500 to-red-600',
  'from-rose-600 to-red-600',
  'from-pink-500 to-rose-500',
  'from-fuchsia-600 to-purple-600',
  'from-purple-600 to-indigo-700',
]

/** 根据任意文本稳定地取一个渐变色（同一文本永远同色）。 */
export function gradientFor(text = '') {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return GRADIENTS[hash % GRADIENTS.length]
}

/** 取标题缩写作为徽章文字（2 个字符，中文取前两个，英文取首字母组合）。 */
export function initials(title = '') {
  const t = title.trim()
  if (!t) return '?'
  if (/[\u4e00-\u9fa5]/.test(t)) return t.slice(0, 2)
  const words = t.split(/[\s._-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

/* --------------------------- 金额 / 数字 --------------------------- */
export function formatMoney(value, { sign = false } = {}) {
  const n = Number(value) || 0
  const str = n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (sign && n > 0) return `+${str}`
  return str
}

/** 大额简写：128400 -> 12.8万 */
export function formatCompact(value) {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return formatMoney(n)
}

/* --------------------------- 日期 / 时间 --------------------------- */
export function parseDate(value) {
  if (!value) return null
  // 后端日期字段是 YYYY-MM-DD；时间戳字段可能带时区。
  const d = len(value) === 10 ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function len(value) {
  return String(value).length
}

export function formatDate(value) {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatDateTime(value) {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 具体日期。 */
export function relativeTime(value) {
  const d = parseDate(value)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return formatDate(value)
}

/** 今天（Asia/Shanghai 语义下的本地今天）的 YYYY-MM-DD。 */
export function todayISO() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 距今天还有多少天（负数表示已逾期）。 */
export function daysUntil(value) {
  const d = parseDate(value)
  if (!d) return null
  const today = parseDate(todayISO())
  return Math.round((d - today) / 86400000)
}

/* --------------------------- 业务元数据 --------------------------- */
export const PRIORITY_META = {
  0: { label: '无', badge: 'bg-white/5 text-slate-400 border-white/10' },
  1: { label: '低', badge: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  2: { label: '中', badge: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  3: { label: '高', badge: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
}

export const PRIORITY_OPTIONS = [
  { value: 0, label: '无优先级' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
]

export const CYCLE_OPTIONS = [
  { value: '', label: '不循环（一次性）' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月（按到期日）' },
  { value: 'month_start', label: '每月（自然月）' },
  { value: 'yearly', label: '每年' },
  { value: 'days', label: '自定义天数' },
]

export const CYCLE_LABELS = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  month_start: '每月',
  yearly: '每年',
  days: '自定义',
  none: '不循环',
}

export const RECORD_TYPE_META = {
  income: { label: '收入', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-400/30', sign: '+' },
  expense: { label: '支出', color: 'text-rose-400', bg: 'bg-rose-500/15 border-rose-400/30', sign: '-' },
  debt_in: { label: '借入', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-400/30', sign: '+' },
  debt_out: { label: '还款', color: 'text-sky-400', bg: 'bg-sky-500/15 border-sky-400/30', sign: '-' },
}

export const RECORD_TYPE_OPTIONS = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'debt_in', label: '借入' },
  { value: 'debt_out', label: '还款' },
]

/** 按分类标签稳定分色。 */
export function tagColor(tag = '') {
  const palette = [
    'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
    'bg-sky-500/15 text-sky-300 border-sky-400/30',
    'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
    'bg-amber-500/15 text-amber-300 border-amber-400/30',
    'bg-rose-500/15 text-rose-300 border-rose-400/30',
    'bg-violet-500/15 text-violet-300 border-violet-400/30',
    'bg-cyan-500/15 text-cyan-300 border-cyan-400/30',
    'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/30',
  ]
  let hash = 0
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

/** 标签输入统一解析：支持逗号/顿号/空格分隔，去重去空。 */
export function parseTags(input) {
  if (Array.isArray(input)) return input.map((t) => String(t).trim()).filter(Boolean)
  return String(input || '')
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean)
}
