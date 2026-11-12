import { reactive } from 'vue'

import { api, clearApiCache, onUnauthorized } from '@/api'

// 全局登录状态：由统一登录中心（auth-server）签发的共享 Cookie 决定。
// 本应用不再提供登录页，未登录统一跳转到 auth-server。
export const auth = reactive({
  checked: false,
  enabled: true,
  authenticated: false,
  loginUrl: '',
})

function goLogin() {
  if (!auth.loginUrl) return false
  const next = encodeURIComponent(window.location.href)
  const sep = auth.loginUrl.includes('?') ? '&' : '?'
  window.location.replace(`${auth.loginUrl}${sep}next=${next}`)
  return true
}

// 任何接口返回 401（会话过期/被登出）都直接切回登录中心，避免页面半残。
onUnauthorized(() => {
  if (auth.enabled && goLogin()) return
  if (auth.enabled) auth.authenticated = false
  clearApiCache()
})

export async function loadAuth() {
  try {
    const data = await api.auth.status()
    auth.enabled = !!data?.enabled
    auth.loginUrl = data?.login_url || ''
    auth.authenticated = !auth.enabled || !!data?.authenticated
  } catch {
    // 后端暂时不可用时不要把用户挡在登录页：保持旧行为，进入主界面看错误提示。
    auth.enabled = false
    auth.authenticated = true
  }

  if (auth.enabled && !auth.authenticated && auth.loginUrl) {
    goLogin()
    return
  }
  auth.checked = true
}

export async function signOut() {
  try {
    await api.auth.logout()
  } catch {
    /* 退出失败也回登录页，服务端会话到期后自然失效 */
  }
  auth.authenticated = false
  clearApiCache()
  if (auth.loginUrl) goLogin()
}
