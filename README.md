# TaskOps 控制台

前端（PHP 页面 + 原生 JS）与后端（FastAPI，多文件工程）通过 nginx 一并托管。

## 运行结构

| 组件 | 技术 | 地址 |
| --- | --- | --- |
| Web 入口 | nginx + php-fpm | `http://<主机>:8281` |
| 前端页面 | `前端/index.php`（php-fpm 执行，端口 9000 回环） | — |
| 后端接口 | FastAPI + uvicorn | `http://<主机>:8000` |

前端 `前端/js/app.js` 里 `BACKEND = 'http://' + location.hostname + ':8000'`，
即浏览器直接跨域调用后端 8000 端口（后端已开启全量 CORS）。

## 目录结构

```
前端/
├── index.php          # 页面骨架（注入 API_BASE、静态资源版本号）
├── css/style.css
└── js/{app.js,notify.js}
后端/
├── main.py            # FastAPI 入口（组装 + 启动）
├── db.py              # 各域 SQLite 引擎 / 会话
├── models.py          # 数据表模型
├── utils.py           # 日期 / 循环 / 资金纯函数
└── routers/           # todos / bookmarks / server / ledger / notes / mindmaps
nginx/nginx.conf       # 8281 静态 + .php 转发到 php-fpm:9000
容器构建脚本/
├── init-components.sh # 镜像构建期：装依赖 + 拉取前后端文件 + 配置 php-fpm
└── start.sh           # 容器启动：复制文件到 /app、起 uvicorn/php-fpm/nginx
docker-compose.yml     # network_mode: host，数据卷 ./app:/app
```

## 构建与运行

```bash
# 1. 构建镜像（Dockerfile 会自动拉取 容器构建脚本/ 并执行）
docker build -t xct258/taskops .

# 2. 启动（host 网络，直接占用 8000 / 8281）
docker compose up -d
```

浏览器访问 `http://<主机>:8281`。

## 数据持久化

各业务域的 SQLite 文件位于容器内 `/app/后端/data/`，通过 `./app:/app` 卷持久化到宿主机。
`start.sh` 复制镜像内置文件时使用 `cp -rn`（不覆盖），因此升级镜像不会清空已有数据。
删除对应 `.db` 后重启即可按新表结构重建（会丢数据，先备份）。
