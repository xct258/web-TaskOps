import { trackRequest } from '@/composables/useNet'

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

// 会话失效统一回调：useAuth 注册后，任何接口 401 都会切回登录页。
let unauthorizedHandler = null
export function onUnauthorized(fn) {
  unauthorizedHandler = fn
}

// ---------------------------------------------------------------------------
// GET 内存缓存
//   登录后先把各模块列表预加载好，切换页面时直接命中缓存，不再重新请求。
//   变更接口成功后只更新对应资源；账本等联动数据无法安全合并时只失效。
// ---------------------------------------------------------------------------
const responseCache = new Map()
const inflight = new Map()
let cacheEpoch = 0

function cacheKey(method, path) {
  return `${method} ${path}`
}

/** 某个资源的列表缓存键：GET /notes、GET /notes?xxx，不包含 /notes/1/history。 */
function listKeys(resource) {
  const prefix = `GET /${resource}`
  return [...responseCache.keys()].filter(
    (key) => key === prefix || key.startsWith(`${prefix}?`),
  )
}

/** 分页列表只把新建项放进第一页，避免每页都重复出现。 */
function isFirstPageKey(key) {
  return !key.includes('offset=') || /[?&]offset=0(?:&|$)/.test(key)
}

function patchListCaches(resource, method, path, result) {
  const segs = path.split('?')[0].split('/').filter(Boolean)
  const itemId = segs[1]

  if (method === 'DELETE') {
    if (itemId == null) return
    for (const key of listKeys(resource)) {
      const list = responseCache.get(key)
      if (!Array.isArray(list)) continue
      responseCache.set(
        key,
        list.filter((item) => String(item?.id) !== String(itemId)),
      )
    }
    return
  }

  if (!result || typeof result !== 'object' || Array.isArray(result) || result.id == null) {
    for (const key of listKeys(resource)) responseCache.delete(key)
    return
  }

  for (const key of listKeys(resource)) {
    const list = responseCache.get(key)
    if (!Array.isArray(list)) continue
    const idx = list.findIndex((item) => String(item?.id) === String(result.id))
    if (idx >= 0) {
      const next = list.slice()
      next[idx] = result
      responseCache.set(key, next)
    } else if (method === 'POST' && isFirstPageKey(key)) {
      responseCache.set(key, [result, ...list])
    }
  }
}

function patchCacheAfterMutation(method, path, result) {
  const segs = path.split('?')[0].split('/').filter(Boolean)
  const resource = segs[0]
  if (!resource || resource === 'auth' || resource === 'config') return

  // 服务信息是实时数据，直接失效，下一页/下一次刷新重新取。
  if (resource === 'monitor') {
    for (const key of [...responseCache.keys()]) {
      if (key.startsWith('GET /monitor')) responseCache.delete(key)
    }
    return
  }

  // 库存变动返回的是 movement 而不是物品本身，按数量补到物品缓存。
  if (resource === 'inventory' && segs[2] === 'movements') {
    const itemId = segs[1]
    const delta = Number(result?.quantity_delta) || 0
    for (const key of listKeys('inventory')) {
      const list = responseCache.get(key)
      if (!Array.isArray(list)) continue
      responseCache.set(
        key,
        list.map((item) =>
          String(item?.id) === String(itemId)
            ? {
                ...item,
                quantity: Number(item.quantity || 0) + delta,
                updated_at: result?.created_at || item.updated_at,
              }
            : item,
        ),
      )
    }
    return
  }

  // 账本、资产、负债互相联动，派生数据统一失效；流水列表就地合并。
  if (resource === 'ledger' || resource === 'asset' || resource === 'liability') {
    if (resource === 'ledger') patchListCaches('ledger', method, path, result)
    for (const key of ['GET /ledger/summary', 'GET /ledger/loans', 'GET /asset', 'GET /liability']) {
      responseCache.delete(key)
    }
    return
  }

  patchListCaches(resource, method, path, result)
}

/** 清空缓存：退出登录 / 会话失效后避免把上一个会话的数据带给下一个用户。 */
export function clearApiCache() {
  cacheEpoch += 1
  responseCache.clear()
  inflight.clear()
}

async function requestRaw(path, { method = 'GET', body, signal } = {}) {
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
    if (res.status === 401) unauthorizedHandler?.()
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

/**
 * 统一请求入口。
 * options:
 *   force      GET 跳过缓存，强制回源（刷新按钮 / 服务信息定时刷新）
 *   background 不计入首屏 pending（预加载用）
 *   cache      GET 是否读写缓存，默认 true
 */
function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    signal,
    force = false,
    background = false,
    cache = method === 'GET',
  } = options
  const key = cacheKey(method, path)

  if (method === 'GET' && cache && !force) {
    if (responseCache.has(key)) {
      const data = responseCache.get(key)
      return Promise.resolve(Array.isArray(data) ? data.slice() : data)
    }
    if (inflight.has(key)) {
      const pending = inflight.get(key)
      // 当前页面复用了后台预加载的请求时，也要计入首屏等待。
      return background ? pending : trackRequest(pending)
    }
  }

  const task = requestRaw(path, { method, body, signal })
  const tracked = background ? task : trackRequest(task)
  const epoch = cacheEpoch

  const result = tracked
    .then((data) => {
      if (epoch !== cacheEpoch) return data
      if (method === 'GET' && cache) responseCache.set(key, data)
      if (method !== 'GET') patchCacheAfterMutation(method, path, data)
      return data
    })
    .finally(() => {
      if (inflight.get(key) === result) inflight.delete(key)
    })

  if (method === 'GET' && cache && !force) inflight.set(key, result)
  return result
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
  /* --------------------------- 运行时配置 --------------------------- */
  config: {
    // 壁纸图片接口地址等由后端环境变量提供，改 compose 重启即可生效。
    get: () => request('/config'),
  },

  /* ----------------------------- 登录 ----------------------------- */
  auth: {
    // 登录状态不能缓存，否则会话失效后仍会被当成已登录。
    status: () => request('/auth/status', { cache: false }),
    logout: () => request('/auth/logout', { method: 'POST' }),
  },

  /* ----------------------------- 书签 ----------------------------- */
  bookmarks: {
    list: (opts = {}) => request('/bookmarks', opts),
    create: (data) => request('/bookmarks', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/bookmarks/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/bookmarks/${id}`, { method: 'DELETE' }),
    visit: (id) => request(`/bookmarks/${id}/visit`, { method: 'POST' }),
    // 右键「更新图标」：后端重新抓取站点图标，拿不到则清空（前端回退首字母）
    refreshFavicon: (id) => request(`/bookmarks/${id}/favicon`, { method: 'POST' }),
  },

  /* ----------------------------- 待办 ----------------------------- */
  todos: {
    list: (opts = {}) => request('/todos', opts),
    create: (data) => request('/todos', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/todos/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/todos/${id}`, { method: 'DELETE' }),
    markProcessed: (id) => request(`/todos/${id}/processed`, { method: 'PUT' }),
    undo: (id) => request(`/todos/${id}/undo`, { method: 'POST' }),
    snooze: (id) => request(`/todos/${id}/snooze`, { method: 'POST' }),
    history: (id, opts = {}) => request(`/todos/${id}/history`, { ...opts, cache: false }),
  },

  /* --------------------------- 服务信息 --------------------------- */
  monitor: {
    // 后端代理 push-server 的 /records，按 server_name 分组返回 latest + 历史。
    servers: (params = {}, opts = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
      )
      return request(`/monitor/servers${qs.toString() ? `?${qs}` : ''}`, opts)
    },
    // 消除单条消息：只记录被消除的上报，不牵连同服务器的其他报警。
    ackRecord: (serverName, recordId, data = {}) =>
      request(`/monitor/servers/${encodeURIComponent(serverName)}/records/${recordId}/ack`, {
        method: 'POST',
        body: clean(data),
      }),
    // 一键消除某台服务器下全部未消除的报警。
    ackAll: (serverName) =>
      request(`/monitor/servers/${encodeURIComponent(serverName)}/ack-all`, {
        method: 'POST',
      }),
    restoreRecord: (serverName, recordId, createdAt = '') => {
      const query = createdAt ? `?created_at=${encodeURIComponent(createdAt)}` : ''
      return request(
        `/monitor/servers/${encodeURIComponent(serverName)}/records/${recordId}/ack${query}`,
        { method: 'DELETE' },
      )
    },
  },

  /* ----------------------------- 账本 ----------------------------- */
  ledger: {
    list: (offset = 0, opts = {}) => request(`/ledger?offset=${offset}&limit=200`, opts),
    summary: (opts = {}) => request('/ledger/summary', opts),
    loans: (opts = {}) => request('/ledger/loans', opts),
    createPurchase: (data) => request('/ledger/financed-purchases', { method: 'POST', body: clean(data) }),
    updatePurchase: (id, data) => request(`/ledger/financed-purchases/${id}`, { method: 'PUT', body: clean(data) }),
    create: (data) => request('/ledger', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/ledger/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/ledger/${id}`, { method: 'DELETE' }),
    getAsset: (opts = {}) => request('/asset', opts),
    getLiability: (opts = {}) => request('/liability', opts),
  },

  /* ----------------------------- 笔记 ----------------------------- */
  notes: {
    list: (opts = {}) => request('/notes', opts),
    create: (data) => request('/notes', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/notes/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/notes/${id}`, { method: 'DELETE' }),
  },

  /* --------------------------- 思维导图 --------------------------- */
  mindmaps: {
    list: (opts = {}) => request('/mindmaps', opts),
    create: (data) => request('/mindmaps', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/mindmaps/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/mindmaps/${id}`, { method: 'DELETE' }),
  },
  inventory: {
    list: (params = {}, opts = {}) =>
      request(
        `/inventory${params.q || params.category ? `?${new URLSearchParams(Object.entries(params).filter(([, value]) => value))}` : ''}`,
        opts,
      ),
    create: (data) => request('/inventory', { method: 'POST', body: clean(data) }),
    update: (id, data) => request(`/inventory/${id}`, { method: 'PUT', body: clean(data) }),
    remove: (id) => request(`/inventory/${id}`, { method: 'DELETE' }),
    movements: (id, opts = {}) => request(`/inventory/${id}/movements`, { ...opts, cache: false }),
    move: (id, data) => request(`/inventory/${id}/movements`, { method: 'POST', body: clean(data) }),
  },
}

export { ApiError }
