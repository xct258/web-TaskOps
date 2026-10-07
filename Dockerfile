# 使用 中文Debian 作为基础镜像
FROM xct258/debian-cn

# 安装构建所需的相关依赖
RUN apt update \
    && apt install -y wget \
    # 创建临时目录
    && mkdir -p /root/tmp \
    # 下载容器构建脚本
    && wget -O /root/tmp/init-components.sh https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main/容器构建脚本/init-components.sh \
    && chmod +x /root/tmp/init-components.sh \
    # 执行容器构建脚本
    && /root/tmp/init-components.sh \
    # 清理临时目录
    && rm -rf /root/tmp \
    # 下载容器启动脚本
    && wget -O /usr/local/bin/start.sh https://raw.githubusercontent.com/xct258/web-TaskOps/refs/heads/main/容器构建脚本/start.sh \
    # 赋予启动脚本执行权限
    && chmod +x /usr/local/bin/start.sh
# 设置容器启动时执行的命令
ENTRYPOINT ["/usr/local/bin/start.sh"]