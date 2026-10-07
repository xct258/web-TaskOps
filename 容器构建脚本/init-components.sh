#!/bin/bash
set -e

# 安装必要软件（python3 跑后端 FastAPI，php-fpm 跑前端 index.php，nginx 做 Web 服务器）
apt update
apt install -y curl nano jq bc python3 python3-pip nginx php-fpm php-cli
pip3 install --no-cache-dir --break-system-packages uvicorn fastapi sqlmodel

# 让 php-fpm 监听 TCP 9000，供 nginx 通过 fastcgi 转发（不依赖 php 版本号）
sed -i 's|^listen = .*|listen = 127.0.0.1:9000|' /etc/php/*/fpm/pool.d/www.conf

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
mkdir -p /opt/taskops/前端/css /opt/taskops/前端/js /opt/taskops/后端/routers /opt/taskops/nginx

# 前端（PHP 页面 + 静态资源）
wget -O /opt/taskops/前端/index.php "$RAW/前端/index.php"
wget -O /opt/taskops/前端/css/style.css "$RAW/前端/css/style.css"
wget -O /opt/taskops/前端/js/app.js "$RAW/前端/js/app.js"
wget -O /opt/taskops/前端/js/notify.js "$RAW/前端/js/notify.js"

# 后端（拆分后的 FastAPI 工程：入口 + 数据库/模型/工具 + 各业务路由）
wget -O /opt/taskops/后端/main.py "$RAW/后端/main.py"
wget -O /opt/taskops/后端/db.py "$RAW/后端/db.py"
wget -O /opt/taskops/后端/models.py "$RAW/后端/models.py"
wget -O /opt/taskops/后端/utils.py "$RAW/后端/utils.py"
wget -O /opt/taskops/后端/routers/todos.py "$RAW/后端/routers/todos.py"
wget -O /opt/taskops/后端/routers/bookmarks.py "$RAW/后端/routers/bookmarks.py"
wget -O /opt/taskops/后端/routers/server.py "$RAW/后端/routers/server.py"
wget -O /opt/taskops/后端/routers/ledger.py "$RAW/后端/routers/ledger.py"
wget -O /opt/taskops/后端/routers/notes.py "$RAW/后端/routers/notes.py"
wget -O /opt/taskops/后端/routers/mindmaps.py "$RAW/后端/routers/mindmaps.py"

# nginx
wget -O /opt/taskops/nginx/nginx.conf "$RAW/nginx/nginx.conf"