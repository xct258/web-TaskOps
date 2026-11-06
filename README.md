# TaskOps 控制台

个人自用的控制台应用：前端为 **Vue 3 + Vite 单页应用（构建产物 `dist/`）**，后端为 **FastAPI 多文件工程**，两者跑在同一个容器里。
适合内网/个人服务器部署，配合反向代理对外提供单一域名。

---

## 一、架构与端口

| 组件 | 技术 | 监听 | 对外 |
| --- | --- | --- | --- |
| 前端页面 + 接口 | FastAPI + uvicorn，直接托管 Vue 构建产物 `dist` | `8281` | 经反代 |

- 和 push-server 一样，前端和 `/api/*` 跑在**同一个 FastAPI 进程、同一个端口 8281**，天然同源，**无跨域**。
- 后端所有业务路由都挂在 `/api` 下（如 `/api/todos`）；NPM 只需要把整个域名转发到 `8281`，不需要单独配置 `/api`。
- 直接访问 `http://<主机>:8281` 就能打开完整应用，`http://<主机>:8281/api/todos` 就是接口。

---

### 账本说明

账本采用资金口径：**净资金 = 资金余额 − 负债**，不自动计入房产、投资等未录入资产。
收入和支出调整资金余额；借入同时增加余额和负债；还款扣除本金与利息，负债只扣本金。
本月收支由后端按北京时间月份统计完整流水，支出包含还款利息，不包含还款本金。
新增还款必须选择借入流水，剩余本金按该笔借款的本金减去关联还款本金计算，利息另计。
借入及贷款购买可选填“约定总利息”：留空表示未知，0 表示无息，仅用于预估，不提前记支出或增加负债本金。
借款列表分别显示未还本金、约定总利息、已付利息、预计未付利息及预计待还合计。
预计未付利息为约定总利息减去实际已付利息，最低为 0；未知约定利息时不估算待还合计。
还款按本次实际支付利息入账，可与约定不同。可将本金填 0 只付利息，实际支付合计须大于 0。
还款表单可一键填入预计剩余全部利息，分期还款时应按本期账单调整；提前还款导致总利息变化时，可修改原借款的约定总利息。
“支出”表单的支付方式可选余额支付、贷款购买或信用卡消费。贷款购买、信用卡消费一次生成同额、同日期的关联借入和支出流水：资金余额不变、负债增加，
消费金额计入支出。可选填贷款机构或信用卡，后续选择对应借款还款，实际利息在还款时记录。
关联购买的两笔流水必须一起编辑或删除；已有还款后不能删除购买，本金不能调低至已还金额以下。
已有还款的借款不能直接删除或改为其他类型，本金不能低于已还金额。

余额仅由流水维护，界面和接口均不允许直接校准。新增、修改、删除流水都不能导致资金或负债为负。
收入、支出和借入金额须大于零；还款本金可为零，利息不能为负，
金额按分四舍五入并使用 Decimal 计算。新账本从零开始，每笔资金变动必须通过流水记录。
当前为开发版本，启动仅按当前模型建表，不提供旧数据库迁移、校准或历史结转逻辑。
账本模型字段变化后，停止后端并删除 `后端/data/ledger.db`，再启动后端即可按当前模型重新建库。

## 二、目录结构

```
前端/
├── src/               # Vue 3 源码（views / composables / api / router）
├── index.html         # Vite 入口（构建后由 dist/index.html 取代）
├── package.json       # 构建依赖（node_modules 不入库，构建时安装）
├── vite.config.js     # /api 反代与 allowedHosts（隧道域名放行）
└── dist/              # 构建产物（不入库）：容器构建时生成并托管
后端/
├── main.py            # FastAPI 入口：CORS、lifespan 建表、挂载 /api 路由、/docs
├── db.py              # 各业务域独立 SQLite 引擎 / 会话工厂
├── models.py          # 数据表模型（Todo/Bookmark/Ledger/Asset/Liability/Note/MindMap）
├── utils.py           # 日期、循环周期、账本资金影响等纯函数
└── routers/           # 各业务路由：todos / bookmarks / monitor / ledger / notes / mindmaps
install/                # 构建期（docker-image-template）
├── app.conf            # 镜像名 / 架构 / apt / pip 依赖
├── install.sh          # 模板通用安装器
└── custom-install.sh   # 下载 Node 构建前端，拷贝后端到 /opt/taskops
startup/                # 运行期
├── prepare.sh          # 每次启动：同步代码到 /app
├── once.sh             # 只执行一次
├── update.sh           # 自动更新（本仓库保持空操作）
├── services.sh         # 声明 api + web 两个进程
└── main.sh             # 固定薄壳：加载 supervisor + services
template/               # 模板固定文件
├── Dockerfile
├── start.sh
└── supervisor.sh       # 多进程启动/停止/日志/信号处理
check.sh                # 本地自查（push 前运行）
docker-compose.yml      # 运行容器（host 网络 + 数据卷）
```

---

## 三、构建与部署（docker-image-template）

本仓库使用 [xct258/docker-image-template](https://github.com/xct258/docker-image-template)：
镜像只通过 GitHub Actions 构建，本地不需要安装 Docker。

### 1. 构建镜像

Actions 页面 → **Build and Push Docker Image** → **Run workflow**。工作流会：

1. 运行 `bash check.sh` 做静态校验；
2. 按 `install/app.conf` 读取镜像名、标签和架构；
3. 用 `template/Dockerfile` 构建并推送 `xct258/taskops:latest`（每月 1 日也会自动构建）。

需要在仓库 Secrets 中配置 `DOCKERACC` / `DOCKERPWD`。

### 2. 启动 / 更新

```bash
docker compose pull
docker compose up -d
```

`docker-compose.yml`：

```yaml
services:
  taskops:
    container_name: taskops
    image: xct258/taskops:latest
    network_mode: host        # 直接占用宿主机 8281
    volumes:
      - ./app:/app            # 代码 + 数据库持久化
      - ./data:/data          # 模板日志与一次性启动标记
    restart: unless-stopped
    init: true                # 多进程容器用 tini 回收孤儿进程
    stop_grace_period: 30s
```

### 3. 访问

- 经反代：`https://taskops.你的域名.com`（推荐）
- 直连自测：`http://<主机>:8281/api/todos`
- API 文档：`http://<主机>:8281/docs`

---

## 四、容器启动流程

`docker compose up` 后执行 `ENTRYPOINT` 即 `/opt/start.sh`，按模板顺序运行：

1. `startup/prepare.sh`（每次启动）：建目录；前端从 `/opt/taskops/前端` 清空重铺到 `/app/前端`；
   后端用 `cp -rn` 从 `/opt/taskops/后端` 补到 `/app/后端`（保住 `data/` 与用户改动）；`chmod -R a+rX /app/前端`。
2. `startup/update.sh`：本仓库为空操作，版本跟随镜像。
3. `startup/once.sh`：只执行一次，确保 `/app/后端/data` 存在。
4. `startup/main.sh`：固定薄壳，加载 `template/supervisor.sh` 和 `startup/services.sh`。
   `services.sh` 只声明一个服务：`uvicorn main:app --app-dir /app/后端 --host 0.0.0.0 --port 8281`。
   FastAPI 在同一个端口同时提供页面、静态资源、`/api/*` 和 `/docs`，与 push-server 的做法一致。
   进程退出后容器结束，由 `restart` 策略拉起；`docker stop` 时等待超时后退出。

服务日志写在容器内 `/data/logs/service/api.log`（宿主机 `./data/logs/service/api.log`），
启动脚本日志在 `/data/logs/<脚本名>/...`。

---

## 五、反向代理（Nginx Proxy Manager）

前端和 `/api` 都在 `8281` 上，NPM 只需要一个普通的 Proxy Host 转发到 `8281`，
**不要再给 `/api` 单独建 Custom Location**。

### 网络前提

TaskOps 用 `network_mode: host`，端口在宿主机上。NPM 若在 Docker bridge 网络里，
容器内的 `127.0.0.1` 是它自己，够不到宿主机，二选一：

- **NPM 也用 host 网络**：转发目标直接填 `127.0.0.1`（最省事）。
- **给 NPM 加 host 映射**：`extra_hosts: ["host.docker.internal:host-gateway"]`，目标填 `host.docker.internal`。

### Proxy Host 配置

| 项 | 值 |
| --- | --- |
| Domain Names | `taskops.你的域名.com` |
| Scheme | `http` |
| Forward Hostname / IP | `127.0.0.1`（或 `host.docker.internal`） |
| Forward Port | `8281` |
| SSL | 申请 Let's Encrypt，开启 Force SSL |

> 浏览器请求 `/api/todos` 时，NPM 原样转给 `8281/api/todos`，FastAPI 在同进程内处理。
> 不需要 rewrite，也不要把 `/api` 指向别的端口。

### 可选：API 文档

`/docs` 和 `/openapi.json` 也在 8281 上，和页面同源，已经可以随域名一起访问，无需额外配置。

### 防火墙

只对外放行 NPM 的 `80/443`；`8281` 只留给反代内网访问。

---

## 六、数据持久化与升级

- 各业务域 SQLite 文件位于容器内 `/app/后端/data/`，通过 `./app:/app` 持久化到宿主机。
- `startup/prepare.sh` 复制代码：前端清空重铺（构建产物随镜像版本走），后端 `cp -rn` **不覆盖已存在文件**：
  升级镜像不会清空数据，但卷里后端旧代码也不会被自动覆盖（前端不受此限制）。
- 模板日志和一次性启动标记在容器内 `/data`，通过 `./data:/data` 持久化到宿主机。
- 改了表结构：删对应 `.db` 后重启，`lifespan` 会按新模型重建（会丢数据，先备份）。
- 书签图标由后端抓取后缓存在 `/app/后端/data/favicons/`，通过 `/api/favicons/<文件名>` 只读暴露；
  新建书签时试抓一次，抓不到就让前端显示首字母；只有右键「更新图标」才会重新抓取。
- 改版升级：如需让卷内代码更新，删掉 `/app` 下对应旧文件再重启，或清空卷（会丢数据）。

---

## 七、后端 API 一览（前缀 `/api`）

| 域 | 方法与路径 |
| --- | --- |
| 配置 | `GET /api/config`（前端运行时配置，如壁纸接口地址） |
| 待办 | `GET/POST /api/todos`、`PUT/DELETE /api/todos/{rid}`、`PUT /api/todos/{rid}/processed`、`POST /api/todos/{rid}/undo`、`POST /api/todos/{rid}/snooze` |
| 书签 | `GET/POST /api/bookmarks`、`PUT/DELETE /api/bookmarks/{bid}`、`POST /api/bookmarks/{bid}/visit`、`POST /api/bookmarks/{bid}/favicon`（重新抓取站点图标） |
| 服务信息 | `GET /api/monitor/servers`（按服务器分组）、`GET /api/monitor/records`、`GET /api/monitor/health`、`POST/DELETE /api/monitor/servers/{server_name}/records/{record_id}/ack` |
| 账本 | `GET/POST /api/ledger`、`PUT/DELETE /api/ledger/{ledger_id}` |
| 资产/负债 | `GET/POST /api/asset`、`GET/POST /api/liability` |
| 笔记 | `GET/POST /api/notes`、`PUT/DELETE /api/notes/{nid}` |
| 思维导图 | `GET/POST /api/mindmaps`、`PUT/DELETE /api/mindmaps/{mid}` |

> 在线调试：`http://<主机>:8281/docs`（Scalar 文档，数据来自 `/openapi.json`）。
>
> 服务信息的数据源是 push-server：服务器脚本 `POST /api/push` 上报，TaskOps 读取其 `GET /records` 并按 `server_name` 分组展示；卡片弹窗采用左右分栏：左侧按 `topic`（项目）→ `title`（服务）两级切换，右侧显示当前范围的记录并分页，支持「全部项目」和「全部服务」；移动端把左侧栏收进服务器名称旁边的按钮，按钮显示当前项目/服务，点击后弹窗选择。上报层级为 `server_name`（服务器）→ `topic`（项目）→ `title`（项目里的脚本）。`/api/push` 的 `category`（服务消息固定传 `service`）、`title` 和 `status`（`ok` / `warn` / `error` / `info`）为必填；TaskOps 向 `/api/task` 投递待办时固定传 `category: "todo"`。后端通过 `PUSH_SERVER_URL` 配置地址（默认 `https://push-server.o1-1.xct258.top`），可用 `GET /api/monitor/health` 检查连通性。消息列表里每条报警的「消除报警」只作用于那条记录，不牵连同服务器的其他报警；原始记录仍保留，点「恢复」可以让它重新参与报警判断。

---

## 八、本地开发 / 调试

- 后端（在本目录执行）：
  ```bash
  cd 后端
  uvicorn main:app --host 0.0.0.0 --port 8481
  ```
- 前端（生产模式本地验证）：先 `cd 前端 && npm run build`，再让后端托管构建产物：
  ```bash
  cd 后端
  FRONTEND_DIR=../前端/dist uvicorn main:app --host 0.0.0.0 --port 8281
  ```
  访问 `http://127.0.0.1:8281`，页面和 `/api` 都在 8281。
- 日常开发仍用 `npm run dev`（Vite 自己反代 `/api` 到 `127.0.0.1:8481`）。

---

## 九、访问密码

通过环境变量启用单密码登录（不设置 `APP_PASSWORD` 则保持原来的开放状态）：

| 变量 | 说明 |
| --- | --- |
| `APP_PASSWORD` | 访问密码；留空 = 不启用 |
| `APP_SECRET` | 会话 Cookie 签名密钥；留空则由密码派生（改密码会让所有会话失效） |
| `APP_SESSION_DAYS` | 会话有效天数，默认 `7` |
| `PUSH_SERVER_TOKEN` | 读取 push-server 记录用的服务间令牌，需与 push-server 一致 |
| `WALLPAPER_API_URL` | 壁纸图片接口地址，默认 `https://random-image.xct258.top/`；直接返回图片的接口原样使用，也可写 `{seed}` / `{width}` / `{height}` 模板 |

- 登录成功后写入 `HttpOnly` + `SameSite=Lax` 会话 Cookie；HTTPS（含反代 `X-Forwarded-Proto`）下自动带 `Secure`。
- 同一 IP 连续输错 5 次锁定 60 秒。
- 未登录访问任何 `/api/*` 会返回 401，前端自动显示登录页；页面静态资源本身仍可访问。
- 忘记密码时修改 `APP_PASSWORD` 并重启即可；修改后旧会话自动失效。

`docker-compose.yml` 已接好这些变量，在仓库根目录放一个 `.env`（参考 `.env.example`）后 `docker compose up -d` 生效。

## 十、注意事项

- 后端 CORS 全开且无鉴权，**仅限内网使用，不要直接暴露公网**；对外请通过反代加访问控制。
- 前端构建产物文件名自带哈希，改版后自动换新文件名，无需手动清缓存（强刷即可）。
- 用户密码等敏感信息不要提交进仓库。
