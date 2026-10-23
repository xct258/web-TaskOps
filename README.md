# TaskOps 控制台

个人自用的控制台应用：前端为 **Vue 3 + Vite 单页应用（构建产物 `dist/`）**，后端为 **FastAPI 多文件工程**，两者跑在同一个容器里。
适合内网/个人服务器部署，配合反向代理对外提供单一域名。

---

## 一、架构与端口

| 组件 | 技术 | 监听 | 对外 |
| --- | --- | --- | --- |
| 前端页面 | Vue 3 + Vite 构建产物 `dist`（Python `http.server` 托管） | `8281` | 经反代 |
| 后端接口 | FastAPI + uvicorn（路由统一 `/api` 前缀） | `8481` | 经反代 |

- 前端默认同源请求 `/api/*`（未设置 `VITE_API_BASE` 时），与后端同域，**无跨域**。
- 后端所有业务路由都挂在 `/api` 下（如 `/api/todos`）。
- 生产由反向代理把 `/` 转到 `8281`、`/api/` 转到 `8481`，浏览器只访问一个域名，**无跨域**。
- 直接访问（不走反代）时，`:8281` 没有 `/api`，前端调不到后端，需按第五节配置反代。

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
容器构建脚本/
├── init-components.sh # 镜像构建期：装依赖（含 Node）+ 前端构建 + 拉取后端文件 + 安装 7zz
└── start.sh           # 容器启动：复制文件到 /app、起 uvicorn 与静态服务器
Dockerfile             # 基于 xct258/debian-cn 构建镜像
docker-compose.yml     # 运行容器（host 网络 + 数据卷 ./app:/app）
```

---

## 三、快速开始

### 1. 构建镜像

```bash
docker build -t xct258/taskops .
```

`Dockerfile` 会从 GitHub main 拉取 `容器构建脚本/init-components.sh` 并执行：安装
`python3 / pip(uvicorn fastapi sqlmodel) / Node.js / 7zz`，前端源码构建为 `dist`，
连同后端一起下载到 `/opt/taskops`。

> 构建依赖 GitHub main 上的文件已是最新；若刚改过代码，请先推送再构建。

### 2. 启动

```bash
docker compose up -d
```

`docker-compose.yml`：

```yaml
services:
  taskops:
    container_name: taskops
    image: xct258/taskops
    network_mode: host        # 直接占用宿主机 8281 / 8481
    volumes:
      - ./app:/app            # 代码 + 数据库持久化
    restart: always
```

### 3. 访问

- 经反代：`https://taskops.你的域名.com`（推荐）
- 直连后端自测：`http://<主机>:8481/api/todos`
- 后端 API 文档（直连）：`http://<主机>:8481/docs`

---

## 四、容器启动流程

`docker compose up` 后执行 `ENTRYPOINT` 即 `/usr/local/bin/start.sh`：

1. 建目录 `/app/前端`、`/app/后端`、`/app/后端/routers`。
2. 铺代码到挂载卷：前端是构建产物（哈希文件名），`rm -rf` 后重铺以保证版本一致；
   后端用 `cp -rn`（已存在不覆盖），保住 `data/` 与用户改动。
3. `chmod -R a+rX /app/前端`。
4. 后台启动后端：`uvicorn main:app --app-dir /app/后端 --host 0.0.0.0 --port 8481`。
5. 前台启动前端静态服务器：`python3 -m http.server 8281 --directory /app/前端`（它是容器主进程，退出即容器停止）。

---

## 五、反向代理（Nginx Proxy Manager）

因为前端走相对 `/api`，必须通过反代访问。以 NPM 为例：

### 网络前提

TaskOps 用 `network_mode: host`，端口在宿主机上。NPM 若在 Docker bridge 网络里，
容器内的 `127.0.0.1` 是它自己，够不到宿主机，二选一：

- **NPM 也用 host 网络**：转发目标直接填 `127.0.0.1`（最省事）。
- **给 NPM 加 host 映射**：`extra_hosts: ["host.docker.internal:host-gateway"]`，目标填 `host.docker.internal`。

### Proxy Host 配置

**前端 Proxy Host**

| 项 | 值 |
| --- | --- |
| Domain Names | `taskops.你的域名.com` |
| Scheme | `http` |
| Forward Hostname / IP | `127.0.0.1`（或 `host.docker.internal`） |
| Forward Port | `8281` |
| SSL | 申请 Let's Encrypt，开启 Force SSL |

**该 Proxy Host 下的 Custom Location（后端）**

| 项 | 值 |
| --- | --- |
| Location | `/api` |
| Scheme | `http` |
| Forward Hostname / IP | 同上 |
| Forward Port | `8481` |

> 后端本身就在 `/api` 前缀下，NPM 转发保留原路径且**无需 rewrite**：
> `/api/todos` 会原样转发到 `8481/api/todos`。

### 可选：把 API 文档也代理出去

再加两个 Custom Location 到 `8481`：`/docs` 与 `/openapi.json`。

### 防火墙

只对外放行 NPM 的 `80/443`；`8281`、`8481` 可只留内网。

---

## 六、数据持久化与升级

- 各业务域 SQLite 文件位于容器内 `/app/后端/data/`，通过 `./app:/app` 持久化到宿主机。
- `start.sh` 复制代码：前端清空重铺（构建产物随镜像版本走），后端 `cp -rn` **不覆盖已存在文件**：
  升级镜像不会清空数据，但卷里后端旧代码也不会被自动覆盖（前端不受此限制）。
- 改了表结构：删对应 `.db` 后重启，`lifespan` 会按新模型重建（会丢数据，先备份）。
- 书签图标由后端抓取后缓存在 `/app/后端/data/favicons/`，通过 `/api/favicons/<文件名>` 只读暴露；
  新建书签时试抓一次，抓不到就让前端显示首字母；只有右键「更新图标」才会重新抓取。
- 改版升级：如需让卷内代码更新，删掉 `/app` 下对应旧文件再重启，或清空卷（会丢数据）。

---

## 七、后端 API 一览（前缀 `/api`）

| 域 | 方法与路径 |
| --- | --- |
| 待办 | `GET/POST /api/todos`、`PUT/DELETE /api/todos/{rid}`、`PUT /api/todos/{rid}/processed`、`POST /api/todos/{rid}/undo`、`POST /api/todos/{rid}/snooze` |
| 书签 | `GET/POST /api/bookmarks`、`PUT/DELETE /api/bookmarks/{bid}`、`POST /api/bookmarks/{bid}/visit`、`POST /api/bookmarks/{bid}/favicon`（重新抓取站点图标） |
| 服务信息 | `GET /api/monitor/servers`（按服务器分组）、`GET /api/monitor/records`、`GET /api/monitor/health`、`POST/DELETE /api/monitor/servers/{server_name}/records/{record_id}/ack` |
| 账本 | `GET/POST /api/ledger`、`PUT/DELETE /api/ledger/{ledger_id}` |
| 资产/负债 | `GET/POST /api/asset`、`GET/POST /api/liability` |
| 笔记 | `GET/POST /api/notes`、`PUT/DELETE /api/notes/{nid}` |
| 思维导图 | `GET/POST /api/mindmaps`、`PUT/DELETE /api/mindmaps/{mid}` |

> 在线调试：直连 `http://<主机>:8481/docs`（Scalar 文档，数据来自 `/openapi.json`）。
>
> 服务信息的数据源是 push-server：服务器脚本 `POST /api/push` 上报，TaskOps 读取其 `GET /records` 并按 `server_name` 分组展示；卡片弹窗采用左右分栏：左侧按 `topic`（项目）→ `title`（服务）两级切换，右侧显示当前范围的记录并分页，支持「全部项目」和「全部服务」；移动端把左侧栏收进服务器名称旁边的按钮，按钮显示当前项目/服务，点击后弹窗选择。上报层级为 `server_name`（服务器）→ `topic`（项目）→ `title`（项目里的脚本）。`/api/push` 的 `title` 和 `status`（`ok` / `warn` / `error` / `info`）为必填。后端通过 `PUSH_SERVER_URL` 配置地址（默认 `https://push-server.o1-1.xct258.top`），可用 `GET /api/monitor/health` 检查连通性。消息列表里每条报警的「消除报警」只作用于那条记录，不牵连同服务器的其他报警；原始记录仍保留，点「恢复」可以让它重新参与报警判断。

---

## 八、本地开发 / 调试

- 后端（在本目录执行）：
  ```bash
  cd 后端
  uvicorn main:app --host 0.0.0.0 --port 8481
  ```
- 前端：先构建再托管，例如 `cd 前端 && npm install && npm run build && python3 -m http.server 8281 --directory dist`。
- 不经反代直连调试时，前端调不到 `/api`，开发模式可用 `npm run dev`（`/api` 自动反代到 `127.0.0.1:8481`），
  或临时指定 `VITE_PROXY_TARGET=http://<主机>:8481 npm run dev`。

---

## 九、注意事项

- 后端 CORS 全开且无鉴权，**仅限内网使用，不要直接暴露公网**；对外请通过反代加访问控制。
- 前端构建产物文件名自带哈希，改版后自动换新文件名，无需手动清缓存（强刷即可）。
- 用户密码等敏感信息不要提交进仓库。
