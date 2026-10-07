#!/bin/bash

# 保证挂载目录结构存在（/app 为持久化卷）
mkdir -p /app/前端 /app/后端 /app/后端/routers

# 复制镜像内置文件到 /app（-n 不覆盖：保留卷内已有数据与用户改动）
cp -rn /opt/taskops/前端/. /app/前端/
cp -rn /opt/taskops/后端/. /app/后端/

# 放开前端文件读取权限
chmod -R a+rX /app/前端

# 启动后端 FastAPI（端口 8481，与前端 app.js 里的 BACKEND 保持一致）
# 数据库位于 /app/后端/data（见 db.py），随卷持久化
nohup uvicorn main:app \
  --app-dir /app/后端 \
  --host 0.0.0.0 \
  --port 8481 \
  >/dev/null 2>&1 &

# 启动前端：Python 静态服务器托管 index.html + 静态资源（端口 8281）
exec python3 -m http.server 8281 --directory /app/前端
