#!/bin/bash
# ============================================================
# 只执行一次：第一次启动时执行，成功后写标记 /data/.startup-once.done
#   TaskOps 的数据库在 /app/后端/data，由 prepare.sh 保证目录存在，
#   这里只做一次性的数据目录初始化。
# ============================================================
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/log.sh"

mkdir -p /app/后端/data
log info "数据目录已初始化"
