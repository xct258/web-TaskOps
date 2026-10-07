#!/bin/bash

# 保证挂载目录结构存在（/app 为持久化卷）
mkdir -p /app/前端 /app/后端 /app/后端/routers /app/nginx

# 复制镜像内置文件到 /app（-n 不覆盖：保留卷内已有数据与用户改动）
cp -rn /opt/taskops/前端/. /app/前端/
cp -rn /opt/taskops/后端/. /app/后端/
cp -rn /opt/taskops/nginx/. /app/nginx/

# 放开前端静态/PHP 文件读取权限：nginx 工作进程与 php-fpm(www-data) 需能读取
chmod -R a+rX /app/前端

# 启动后端 FastAPI（端口 8000，与前端 app.js 里的 BACKEND 保持一致）
# 数据库位于 /app/后端/data（见 db.py），随卷持久化
nohup uvicorn main:app \
  --app-dir /app/后端 \
  --host 0.0.0.0 \
  --port 8000 \
  >/dev/null 2>&1 &

# 启动 PHP-FPM（nginx 的 .php 请求转发到 127.0.0.1:9000）
mkdir -p /run/php
PHP_FPM_BIN=$(ls /usr/sbin/php-fpm* 2>/dev/null | head -n1)
if [ -n "$PHP_FPM_BIN" ]; then
    "$PHP_FPM_BIN" -D
fi

# 启动 nginx（前台运行，容器由 nginx 保持存活）
exec nginx -c /app/nginx/nginx.conf -g 'daemon off;'
