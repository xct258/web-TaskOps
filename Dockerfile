# 使用 中文Debian 作为基础镜像
FROM xct258/debian-cn

# 构建脚本直接取自构建上下文（与 Dockerfile 同目录的 容器构建脚本/），
# 不再从 GitHub raw 拉取：构建所用脚本版本 == 本次检出版本，可复现。
# 前端/后端构建产物则在脚本内从 build-latest Release 下载（只下载 + 解压，
# 不在容器内执行 npm 构建），见 容器构建脚本/init-components.sh。
COPY 容器构建脚本/init-components.sh /root/tmp/init-components.sh
COPY 容器构建脚本/start.sh /usr/local/bin/start.sh

# 执行容器构建脚本（下载构建产物并装好运行时依赖），随后清理临时目录
RUN chmod +x /root/tmp/init-components.sh \
    && /root/tmp/init-components.sh \
    && rm -rf /root/tmp \
    && chmod +x /usr/local/bin/start.sh

# 设置容器启动时执行的命令
ENTRYPOINT ["/usr/local/bin/start.sh"]
