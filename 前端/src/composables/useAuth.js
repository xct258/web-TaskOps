import { reactive } from 'vue'

import { api, onUnauthorized } from '@/api'

// 全局登录状态：App.vue 根据它决定显示登录页还是主界面。
export const auth = reactive({
  checked: false,
  enabled: true,
  authenticated: false,
  loading: false,
  error: '',
})

// 任何接口返回 401（会话过期/被登出）都直接切回登录页，避免页面半残。
onUnauthorized(() => {
  if (auth.enabled) auth.authenticated = false
})

export async function loadAuth() {
  try {
    const data = await api.auth.status()
    auth.enabled = !!data?.enabled
    auth.authenticated = !auth.enabled || !!data?.authenticated
  } catch {
    // 后端暂时不可用时不要把用户挡在登录页：保持旧行为，进入主界面看错误提示。
    auth.enabled = false
    auth.authenticated = true
  } finally {
    auth.checked = true
  }
}

export async function signIn(password) {
  if (auth.loading) return false
  auth.loading = true
  auth.error = ''
  try {
    await api.auth.login(password)
    auth.enabled = true
    auth.authenticated = true
    return true
  } catch (err) {
    auth.error = err?.message || '登录失败'
    return false
  } finally {
    auth.loading = false
  }
}

export async function signOut() {
  try {
    await api.auth.logout()
  } catch {
    /* 退出失败也回到登录页，服务端会话到期后自然失效 */
  }
  auth.authenticated = false
  auth.error = ''
}
