#!/bin/bash

mkdir -p /app/前端
mkdir -p /app/后端
mkdir -p /app/nginx

# 复制 /opt/taskops/前端 到 /app/nginx
for file in /opt/taskops/前端/*; do
    filename=$(basename "$file")
    target="/app/前端/$filename"
    if [ -f "$file" ] && [ ! -f "$target" ]; then
        cp "$file" "$target"
    fi
done

# 复制 /opt/taskops/后端 到 /app/fastapi
for file in /opt/taskops/后端/*; do
    filename=$(basename "$file")
    target="/app/后端/$filename"
    if [ -f "$file" ] && [ ! -f "$target" ]; then
        cp "$file" "$target"
    fi
done

# 复制 /opt/taskops/nginx 到 /app/nginx
for file in /opt/taskops/nginx/*; do
    filename=$(basename "$file")
    target="/app/nginx/$filename"
    if [ -f "$file" ] && [ ! -f "$target" ]; then
        cp "$file" "$target"
    fi
done

nohup uvicorn main:app \
  --app-dir /app/后端 \
  --host 0.0.0.0 \
  --port 8009 \
  --reload \
  >/dev/null 2>&1 &

nginx -c /app/nginx/nginx.conf

# 保持容器运行
tail -f /dev/null