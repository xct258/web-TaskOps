# PORTAL 控制台前端

基于项目根目录 `index.html` 模板（深色动漫壁纸 + Tailwind 的 PORTAL 控制台）重写的前端工程，
技术栈 **Vue 3 + Vite + Tailwind CSS**，数据全部对接 `后端/` 的 FastAPI 接口（`/api` 前缀）。

## 功能模块

| 模块 | 路由 | 对应后端接口 |
| --- | --- | --- |
| 书签 | `/#/bookmarks` | `GET/POST /api/bookmarks`、`PUT/DELETE /api/bookmarks/{id}`、`POST /api/bookmarks/{id}/visit` |
| 待办 | `/#/todos` | `GET/POST /api/todos`、`PUT/DELETE /api/todos/{id}`、`processed` / `undo` / `snooze` |
| 服务状态 | `/#/server` | `GET/POST /api/server/status` |
| 账本 | `/#/ledger` | `GET/POST/PUT/DELETE /api/ledger`、`GET/POST /api/asset`、`/api/liability` |
| 笔记 | `/#/notes` | `GET/POST /api/notes`、`PUT/DELETE /api/notes/{id}`（Markdown 渲染） |
| 思维导图 | `/#/mindmaps` | `GET/POST /api/mindmaps`、`PUT/DELETE /api/mindmaps/{id}`（前端解析缩进大纲并自动布局） |

顶部状态胶囊（资产 / 服务在线数 / 待办进度）取自各模块接口的汇总，点击可跳转到对应模块。

## 目录结构

```
前端/
├── index.html              # 应用入口（Vite 模板）
├── vite.config.js          # 开发代理：/api -> http://127.0.0.1:8481
├── tailwind.config.js      # 主题（字体 / xs 断点 / 动画）
├── postcss.config.js
├── src/
│   ├── main.js
│   ├── App.vue             # 单视口控制台外壳：背景 / 顶栏 / 模块导航 / 页脚
│   ├── style.css           # Tailwind + 全局基调 + Markdown 排版
│   ├── api/index.js        # 统一请求封装与全部接口
│   ├── router/index.js     # hash 路由与导航项
│   ├── composables/        # 时钟 / 天气 / 壁纸 / 汇总指标 / Toast
│   ├── components/         # 背景、顶栏、导航、页脚、弹窗、图标等
│   ├── utils/              # 格式化、Markdown 渲染、大纲解析与布局
│   └── views/              # 六大业务模块视图
```

## 本地开发

先启动后端（默认 `8481`）：

```bash
cd 后端
uvicorn main:app --host 0.0.0.0 --port 8481
```

再启动前端：

```bash
cd 前端
npm install
npm run dev        # http://localhost:5180，/api 自动代理到 127.0.0.1:8481
```

若后端不在默认地址，可覆盖代理目标：

```bash
VITE_PROXY_TARGET=http://192.168.1.10:8481 npm run dev
```

> 通过隧道/反代域名（如 `*.xct258.top`）访问 dev server 时：
> `vite.config.js` 已在 `server.allowedHosts` / `preview.allowedHosts` 中放行 `.xct258.top`
> （前导 `.` 表示匹配该域名及其全部子域名，隧道换子域名也无需再改）。
> 换了别的隧道域名时，把对应后缀加进去即可。

## 生产构建与部署

```bash
npm run build      # 产物输出到 前端/dist
```

构建产物是纯静态文件，路由使用 **hash 模式**，因此不需要服务端 history fallback。

- Nginx：把 `dist/` 作为站点根目录，并把 `/api` 反代到后端。
- 或由后端托管：把 `dist/` 内容拷到某个静态目录，用 `StaticFiles` 挂载，`/api` 由后端自身提供。

构建时可用 `VITE_API_BASE` 指定接口前缀（默认 `/api`，与后端同源时无需设置）。

```bash
VITE_API_BASE=/api npm run build
```

## 设计说明

- 沿用模板的「单视口锁定」：页面本身不滚动，仅主内容区内部滚动。
- 复用模板的配色与质感：`slate-950` 底、毛玻璃卡片、indigo/sky/emerald/amber/violet/rose 六色模块强调。
- 深色壁纸来自模板同款随机图接口，顶栏按钮可即时更换。
- 首屏壁纸与正文一起呈现，不显示渐进加载过程（加载失败或 10 秒超时也会放行，页面永不卡死）。
- 书签、待办、笔记、导图均提供完整的增删改查；表单校验与错误通过 Toast 反馈。
