#!/bin/bash
# ============================================================
# 启动前的准备：每次启动容器都执行（docker restart 也会执行）
#   - 前端是构建产物（文件名带哈希）：每次清空重铺
#   - 后端用 cp -n：只补新文件，不覆盖卷内已有代码和 data/
# ============================================================
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/log.sh"

mkdir -p /app/前端 /app/后端/routers

# 前端整目录重铺，保证升级后不会继续跑旧 index.html
rm -rf /app/前端
mkdir -p /app/前端
cp -r /opt/taskops/前端/. /app/前端/

# 后端保留卷内已有文件（data/ 数据库和用户改动优先）
cp -rn /opt/taskops/后端/. /app/后端/

chmod -R a+rX /app/前端

log info "应用文件已同步到 /app"
