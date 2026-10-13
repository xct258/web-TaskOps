"""应用入口：只做组装（CORS、lifespan、挂路由），业务逻辑全在 routers/。

文件结构::

    后端/
    ├── main.py            ← 本文件：组装 + 启动（uvicorn main:app）
    ├── db.py              ← 引擎、会话工厂、建表
    ├── models.py          ← 8 张表结构
    ├── utils.py           ← 日期/周期/资金纯函数
    └── routers/           ← todos / bookmarks / server / ledger / notes / mindmaps

启动（在本目录执行）::

    $ uvicorn main:app --host 0.0.0.0 --port 8481

或直接::

    $ python main.py
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from db import init_db
from routers import bookmarks, inventory, ledger, mindmaps, notes, todos, server


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时建表；关闭时无需清理（SQLite 无连接池可关）。

    约定：开发阶段改表直接删 data/ 下对应 .db 重启重建。
    """
    init_db()
    yield


app = FastAPI(
    version="1.0.0",
    docs_url=None,  # 关闭默认 Swagger，走下面的 Scalar
    redoc_url=None,  # ReDoc 已禁用：其自带表单无障碍告警修不了，只留 /docs
    lifespan=lifespan,
)

# CORS 全开、无鉴权：只放内网，不要直接暴露公网
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路由挂载（统一挂到 /api 前缀，便于 nginx/NPM 反代且与前端同源）
app.include_router(todos.router, prefix="/api")
app.include_router(bookmarks.router, prefix="/api")
app.include_router(server.router, prefix="/api")
app.include_router(ledger.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(mindmaps.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")


@app.get("/docs", include_in_schema=False)
async def scalar_docs():
    """Scalar API 文档（替代 Swagger，无废弃警告）：浏览器打开 /docs 在线调试。

    调试：curl 应看到 api-reference 标记；深色主题 moon。
    """
    return HTMLResponse("""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>控制台后端 API - 在线调试</title>
</head>
<body>
<script
  id="api-reference"
  data-url="/openapi.json"
  data-configuration='{"theme":"moon","layout":"modern","darkMode":true,"localization":{"locale":"zh-CN"}}'
></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>""")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8481)
