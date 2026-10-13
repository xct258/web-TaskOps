import { createRouter, createWebHashHistory } from 'vue-router'

import BookmarksView from '@/views/BookmarksView.vue'
import LedgerView from '@/views/LedgerView.vue'
import InventoryView from '@/views/InventoryView.vue'
import MindmapView from '@/views/MindmapView.vue'
import NotesView from '@/views/NotesView.vue'
import ServerView from '@/views/ServerView.vue'
import TodosView from '@/views/TodosView.vue'

// 导航项：既驱动路由，也驱动顶部模块切换栏。
export const NAV_ITEMS = [
  { name: 'bookmarks', path: '/bookmarks', title: '书签', icon: 'bookmark', accent: 'indigo' },
  { name: 'todos', path: '/todos', title: '待办', icon: 'list', accent: 'sky' },
  { name: 'server', path: '/server', title: '服务', icon: 'server', accent: 'emerald' },
  { name: 'ledger', path: '/ledger', title: '账本', icon: 'wallet', accent: 'amber' },
  { name: 'inventory', path: '/inventory', title: '库存', icon: 'database', accent: 'teal' },
  { name: 'notes', path: '/notes', title: '笔记', icon: 'note', accent: 'violet' },
  { name: 'mindmaps', path: '/mindmaps', title: '导图', icon: 'mindmap', accent: 'rose' },
]

// 使用 hash 路由：构建产物可直接丢给任意静态服务器 / 后端，不需要 history fallback。
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/bookmarks' },
    { path: '/bookmarks', name: 'bookmarks', component: BookmarksView },
    { path: '/todos', name: 'todos', component: TodosView },
    { path: '/server', name: 'server', component: ServerView },
    { path: '/ledger', name: 'ledger', component: LedgerView },
    { path: '/inventory', name: 'inventory', component: InventoryView },
    { path: '/notes', name: 'notes', component: NotesView },
    { path: '/mindmaps', name: 'mindmaps', component: MindmapView },
    { path: '/:pathMatch(.*)*', redirect: '/bookmarks' },
  ],
})

export default router
