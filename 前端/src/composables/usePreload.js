import { api } from '@/api'

/**
 * 登录后后台预热各模块缓存，不阻塞首屏（background 不计入 pending）。
 * 书签/待办/服务信息已由 loadSummary 顺带拉取并写入缓存，这里补齐其余模块。
 */
export function preloadModules() {
  const opts = { background: true }
  return Promise.allSettled([
    api.ledger.list(0, opts),
    api.ledger.summary(opts),
    api.ledger.loans(opts),
    api.inventory.list({}, opts),
    api.notes.list(opts),
    api.mindmaps.list(opts),
  ])
}
