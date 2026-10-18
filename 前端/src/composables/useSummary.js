import { reactive } from 'vue'

import { api } from '@/api'
import { inPending, todayISO } from '@/utils/format'

// 全局汇总指标单例：顶部状态胶囊 + 底部统计共用，避免重复请求。
export const summary = reactive({
  asset: null,
  liability: null,
  bookmarkTotal: 0,
  todoTotal: 0,
  todoOverdue: 0,
  serverTotal: 0,
  serverUp: 0,
  loaded: false,
  loading: false,
  error: '',
})

export async function loadSummary() {
  if (summary.loading) return
  summary.loading = true
  try {
    const [asset, liability, bookmarks, todos, servers] = await Promise.all([
      api.ledger.getAsset().catch(() => null),
      api.ledger.getLiability().catch(() => null),
      api.bookmarks.list().catch(() => []),
      api.todos.list().catch(() => []),
      api.server.list().catch(() => []),
    ])

    const today = todayISO()
    summary.asset = asset?.amount ?? null
    summary.liability = liability?.amount ?? null
    summary.bookmarkTotal = bookmarks.length
    // 「待处理」与待办页签同一口径（inPending）；第二数是其中已逾期的
    const pendingTodos = todos.filter(inPending)
    summary.todoTotal = pendingTodos.length
    summary.todoOverdue = pendingTodos.filter(
      (t) => t.due_time && String(t.due_time).split('T')[0] < today,
    ).length
    summary.serverTotal = servers.length
    summary.serverUp = servers.filter((s) => s.is_success).length
    summary.loaded = true
    summary.error = ''
  } catch (err) {
    summary.error = err?.message || '汇总数据加载失败'
  } finally {
    summary.loading = false
  }
}
