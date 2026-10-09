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

export const api = {
  /* ----------------------------- 书签 ----------------------------- */
  bookmarks: {
    list: () => request('/bookmarks'),
    create: (data) => request('/bookmarks', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/bookmarks/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/bookmarks/${id}`, { method: 'DELETE' }),
    visit: (id) => request(`/bookmarks/${id}/visit`, { method: 'POST' }),
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
  },

  /* --------------------------- 服务状态 --------------------------- */
  server: {
    list: (serverName) =>
      request(`/server/status${serverName ? `?server_name=${encodeURIComponent(serverName)}` : ''}`),
    report: (data) => request('/server/status', { method: 'POST', body: clean(data) }),
  },

  /* ----------------------------- 账本 ----------------------------- */
  ledger: {
    list: () => request('/ledger'),
    create: (data) => request('/ledger', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/ledger/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/ledger/${id}`, { method: 'DELETE' }),
    getAsset: () => request('/asset'),
    setAsset: (amount) => request('/asset', { method: 'POST', body: { amount } }),
    getLiability: () => request('/liability'),
    setLiability: (amount) => request('/liability', { method: 'POST', body: { amount } }),
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
}

export { ApiError }
