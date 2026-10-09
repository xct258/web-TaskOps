import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 开发时把 /api 反代到本机后端（默认 8481），生产构建走同源 /api。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5180,
    // 允许隧道/反代域名访问 dev server。
    // 以 `.` 开头的条目会同时匹配该域名及其全部子域名，
    // 隧道每次分配的子域名不同（如 1-cfyx.o1-1.xct258.top），这样写可避免反复加白名单。
    allowedHosts: ['.xct258.top'],
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8481',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` 默认不带代理，这里补上，方便本地验证构建产物。
  preview: {
    host: true,
    port: 5181,
    allowedHosts: ['.xct258.top'],
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8481',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
