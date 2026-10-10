import { reactive } from 'vue'

// 当前页面的“空白区域右键”菜单：视图挂载时注册，右键空白处由全局处理器弹出。
export const pageMenu = reactive({
  title: '',
  items: [],
})

export function usePageMenu() {
  return {
    setMenu(items, title = '') {
      pageMenu.items = Array.isArray(items) ? items : []
      pageMenu.title = title
    },
    clearMenu() {
      pageMenu.items = []
      pageMenu.title = ''
    },
  }
}
