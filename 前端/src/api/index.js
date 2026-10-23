// 统一 API 客户端：所有请求走 /api 前缀。
// - 开发：vite.config.js 里把 /api 反代到后端的 8481。
// - 生产：与后端同源，直接命中 /api。
const BASE = import.meta.env.VITE_API_BASE || '/api'

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const options = {
    method,
    headers: {},
    signal,
  }

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(`${BASE}${path}`, options)
  } catch (err) {
    throw new ApiError(`无法连接后端 (${BASE})，请确认服务已启动`, 0, err)
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      detail = data?.detail || detail
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), res.status)
  }

  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/** 去掉空字符串/undefined 字段，避免后端拒绝或写入空值。 */
function clean(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue
    out[k] = v
  }
  return out
}

/**
 * 把后端返回的站内路径（如 /api/favicons/3.png）解析到当前 API 前缀。
 * 生产环境 VITE_API_BASE 可能是绝对地址（前后端不同源），不能直接写死 /api。
 */
export function assetUrl(path) {
  if (!path) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path
  if (path.startsWith('/api/')) return `${BASE}${path.slice(4)}`
  return path
}

export const api = {
  /* ----------------------------- 书签 ----------------------------- */
  bookmarks: {
    list: () => request('/bookmarks'),
    create: (data) => request('/bookmarks', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/bookmarks/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/bookmarks/${id}`, { method: 'DELETE' }),
    visit: (id) => request(`/bookmarks/${id}/visit`, { method: 'POST' }),
    // 右键「更新图标」：后端重新抓取站点图标，拿不到则清空（前端回退首字母）
    refreshFavicon: (id) => request(`/bookmarks/${id}/favicon`, { method: 'POST' }),
  },

  /* ----------------------------- 待办 ----------------------------- */
  todos: {
    list: () => request('/todos'),
    create: (data) => request('/todos', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/todos/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/todos/${id}`, { method: 'DELETE' }),
    markProcessed: (id) => request(`/todos/${id}/processed`, { method: 'PUT' }),
    undo: (id) => request(`/todos/${id}/undo`, { method: 'POST' }),
    snooze: (id) => request(`/todos/${id}/snooze`, { method: 'POST' }),
    history: (id) => request(`/todos/${id}/history`),
  },

  /* --------------------------- 服务信息 --------------------------- */
  monitor: {
    // 后端代理 push-server 的 /records，按 server_name 分组返回 latest + 历史。
    servers: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
      )
      return request(`/monitor/servers${qs.toString() ? `?${qs}` : ''}`)
    },
    // 消除单条消息：只记录被消除的上报，不牵连同服务器的其他报警。
    ackRecord: (serverName, recordId, data = {}) =>
      request(`/monitor/servers/${encodeURIComponent(serverName)}/records/${recordId}/ack`, {
        method: 'POST',
        body: clean(data),
      }),
    restoreRecord: (serverName, recordId) =>
      request(`/monitor/servers/${encodeURIComponent(serverName)}/records/${recordId}/ack`, {
        method: 'DELETE',
      }),
  },

  /* ----------------------------- 账本 ----------------------------- */
  ledger: {
    list: (offset = 0) => request(`/ledger?offset=${offset}&limit=200`),
    summary: () => request('/ledger/summary'),
    loans: () => request('/ledger/loans'),
    createPurchase: (data) => request('/ledger/financed-purchases', { method: 'POST', body: clean(data) }),
    updatePurchase: (id, data) => request(`/ledger/financed-purchases/${id}`, { method: 'PUT', body: clean(data) }),
    create: (data) => request('/ledger', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/ledger/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/ledger/${id}`, { method: 'DELETE' }),
    getAsset: () => request('/asset'),
    getLiability: () => request('/liability'),
  },

  /* ----------------------------- 笔记 ----------------------------- */
  notes: {
    list: () => request('/notes'),
    create: (data) => request('/notes', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/notes/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/notes/${id}`, { method: 'DELETE' }),
  },

  /* --------------------------- 思维导图 --------------------------- */
  mindmaps: {
    list: () => request('/mindmaps'),
    create: (data) => request('/mindmaps', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/mindmaps/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/mindmaps/${id}`, { method: 'DELETE' }),
  },
  inventory: {
    list: (params = {}) => request(`/inventory${params.q || params.category ? `?${new URLSearchParams(Object.entries(params).filter(([, value]) => value))}` : ''}`),
    create: (data) => request('/inventory', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/inventory/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/inventory/${id}`, { method: 'DELETE' }),
    movements: (id) => request(`/inventory/${id}/movements`),
    move: (id, data) => request(`/inventory/${id}/movements`, { method: 'POST', body: clean(data) }),
  },
}

export { ApiError }
