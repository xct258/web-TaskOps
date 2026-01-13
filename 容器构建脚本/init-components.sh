#!/bin/bash

# 安装必要软件
apt install -y curl nano jq bc python3 python3-pip nginx
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
mkdir -p /opt/taskops/前端 /opt/taskops/后端 /opt/taskops/nginx
# 前端
wget -O /opt/taskops/前端/index.html https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main/前端/index.html
wget -O /opt/taskops/前端/styles.css https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main/前端/styles.css
# 后端
wget -O /opt/taskops/后端/main.py https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main/后端/main.py
# nginx
wget -O /opt/taskops/nginx/nginx.conf https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main/nginx/nginx.conf