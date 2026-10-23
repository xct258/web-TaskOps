#!/bin/bash
set -e

# 安装必要软件（python3：后端 FastAPI + 前端静态托管）
apt update
apt install -y curl nano jq bc python3 python3-pip
pip3 install --no-cache-dir --break-system-packages uvicorn fastapi sqlmodel

# 获取 7z 下载链接
latest_release_7z=$(curl -s https://api.github.com/repos/ip7z/7zip/releases/latest)
latest_7z_x64_url=$(echo "$latest_release_7z" | jq -r '.assets[] | select(.name | test("linux-x64.tar.xz")) | .browser_download_url')
latest_7z_arm64_url=$(echo "$latest_release_7z" | jq -r '.assets[] | select(.name | test("linux-arm64.tar.xz")) | .browser_download_url')

# 获取服务器架构
arch=$(uname -m)
if [[ $arch == *"x86_64"* ]]; then
    wget -O /root/tmp/7zz.tar.xz "$latest_7z_x64_url"
elif [[ $arch == *"aarch64"* ]]; then
    wget -O /root/tmp/7zz.tar.xz "$latest_7z_arm64_url"
fi

# 安装解压工具
apt install -y tar xz-utils
# 安装7zz
tar -xf /root/tmp/7zz.tar.xz -C /root/tmp
chmod +x /root/tmp/7zz
mv /root/tmp/7zz /bin/7zz

# 下载必要文件
RAW=https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main
mkdir -p /opt/taskops/前端 /opt/taskops/后端/routers

# 前端（Vue 3 + Vite 工程：源码构建，产物 dist 落到 /opt/taskops/前端，由 start.sh 同步并托管）
# 安装 Node.js：apt 自带版本常过旧（Vite 6 需要 Node 18+），按架构下载官方二进制
NODE_VERSION=20.19.2
if [[ $arch == *"x86_64"* ]]; then
    NODE_DIST="node-v${NODE_VERSION}-linux-x64"
elif [[ $arch == *"aarch64"* ]]; then
    NODE_DIST="node-v${NODE_VERSION}-linux-arm64"
else
    echo "不支持的架构：$arch" >&2
    exit 1
fi
wget -O /root/tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz"
tar -xf /root/tmp/node.tar.xz -C /opt
export PATH="/opt/${NODE_DIST}/bin:$PATH"
node --version && npm --version

# 下载仓库源码包并取出 前端/ 构建（源文件三十余个，逐文件 wget 改用整包解压）
wget -O /root/tmp/repo.tar.gz "https://github.com/xct258/web-TaskOps/archive/refs/heads/main.tar.gz"
mkdir -p /root/tmp/repo
tar -xzf /root/tmp/repo.tar.gz -C /root/tmp/repo
cd /root/tmp/repo/web-TaskOps-main/前端
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
npm run build
cp -r dist/. /opt/taskops/前端/
cd /
# 运行时只需要静态产物，Node 工具链移出镜像以保持体积（/root/tmp 由 Dockerfile 后续清理）
rm -rf "/opt/${NODE_DIST}" /root/.npm

# 后端（拆分后的 FastAPI 工程：入口 + 数据库/模型/工具 + 各业务路由）
wget -O /opt/taskops/后端/main.py "$RAW/后端/main.py"
wget -O /opt/taskops/后端/db.py "$RAW/后端/db.py"
wget -O /opt/taskops/后端/models.py "$RAW/后端/models.py"
wget -O /opt/taskops/后端/utils.py "$RAW/后端/utils.py"
wget -O /opt/taskops/后端/favicon.py "$RAW/后端/favicon.py"
wget -O /opt/taskops/后端/routers/todos.py "$RAW/后端/routers/todos.py"
wget -O /opt/taskops/后端/routers/bookmarks.py "$RAW/后端/routers/bookmarks.py"
wget -O /opt/taskops/后端/routers/server.py "$RAW/后端/routers/server.py"
wget -O /opt/taskops/后端/routers/ledger.py "$RAW/后端/routers/ledger.py"
wget -O /opt/taskops/后端/routers/notes.py "$RAW/后端/routers/notes.py"
wget -O /opt/taskops/后端/routers/mindmaps.py "$RAW/后端/routers/mindmaps.py"