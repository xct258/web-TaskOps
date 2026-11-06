#!/bin/bash
# ============================================================
# TaskOps 的服务声明
#   由 template/supervisor.sh 统一启动/停止/记录日志
# ============================================================

SERVICE_NAMES=(api web)
SERVICE_STOP_TIMEOUT=([api]=15 [web]=5)

start_api() {
    run_service api uvicorn main:app \
        --app-dir /app/后端 \
        --host 0.0.0.0 \
        --port "${BACKEND_PORT:-8481}"
}
stop_api() { :; }

start_web() {
    run_service web python3 -m http.server "${FRONTEND_PORT:-8281}" \
        --directory /app/前端
}
stop_web() { :; }
