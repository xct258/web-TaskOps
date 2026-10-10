import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { contextMenuState, useContextMenu } from './composables/useContextMenu'
import { pageMenu } from './composables/usePageMenu'
import './style.css'

const { open } = useContextMenu()

// 全局右键：屏蔽浏览器原生菜单；输入类控件保留原生（方便复制/粘贴）。
// 元素级菜单会自行 preventDefault（此处理检测到 defaultPrevented 即让位）；
// 空白区域则弹出当前页面注册的默认菜单。
document.addEventListener('contextmenu', (e) => {
  const el = e.target
  const editable = el instanceof Element && el.closest('input, textarea, select, [contenteditable="true"]')
  if (editable) return
  if (e.defaultPrevented) return
  e.preventDefault()
  if (contextMenuState.visible || !pageMenu.items.length) return
  open(pageMenu.items, e.clientX, e.clientY, { title: pageMenu.title })
})

createApp(App).use(router).mount('#app')

