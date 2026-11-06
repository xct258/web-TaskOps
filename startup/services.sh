#!/bin/bash
# ============================================================
# TaskOps 的服务声明
#   由 template/supervisor.sh 统一启动/停止/记录日志
#
# 和 push-server 一样：前端构建产物由 FastAPI 托管，页面和 /api
# 跑在同一个进程、同一个端口（8281）。
# ============================================================

SERVICE_NAMES=(api)
SERVICE_STOP_TIMEOUT=([api]=15)

start_api() {
    run_service api uvicorn main:app \
        --app-dir /app/后端 \
        --host 0.0.0.0 \
        --port "${FRONTEND_PORT:-8281}"
}
stop_api() { :; }
