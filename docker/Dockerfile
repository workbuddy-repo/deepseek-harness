# syntax=docker/dockerfile:1
#
# DeepSeek Harness (dsh) 容器镜像
#
# 设计要点（每条都对应一个已验证的约束）：
#   1. Node 必须 >= 22.19 —— CLI 入口使用 import.meta.main，低版本会静默退出 0。
#   2. 走 npm 发行包，不编译源码 —— 原生插件 @deepseek-ai/node-addon-system-*
#      已按平台预编译（glibc / musl 各一份），因此无需 python/g++/make。
#   3. Web 服务器拒绝 0.0.0.0（见 docs/subsystems/web-server.md），
#      必须绑定容器自身网卡地址，由 entrypoint 在运行时解析。
#   4. 全部可变状态收敛到 /data（DSH_HOME），/workspace 挂载项目。

ARG NODE_VERSION=24
ARG DSH_VERSION=0.2.1-rc.2

# ---------- 依赖层：只做 npm 安装，不引入任何编译工具链 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG DSH_VERSION
WORKDIR /opt/dsh

# 关于 npm 11.19+ 的 install-scripts 拦截：这里**保持默认拦截**，是刻意的。
# node-pty / koffi 都随包提供 linux-x64 预编译 .node，运行时加载器会回退到
# prebuilds/；而 node-pty 的 install 脚本在找不到预编译时会触发 node-gyp rebuild，
# 一旦放开反而需要 python/g++/make，把镜像构建绑死在工具链上。
# 已实测：拦截状态下 PTY、子进程均正常。
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefix /opt/dsh --no-audit --no-fund \
        "@deepseek-ai/dsh@${DSH_VERSION}" \
 && npm cache clean --force

# ---------- 运行层 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG DSH_VERSION

LABEL org.opencontainers.image.title="DeepSeek Harness" \
      org.opencontainers.image.description="dsh: everything-is-a-plugin agent harness (developer preview)" \
      org.opencontainers.image.source="https://github.com/deepseek-ai/deepseek-harness" \
      org.opencontainers.image.version="${DSH_VERSION}" \
      org.opencontainers.image.licenses="MIT"

# git: 工作区仓库操作；ripgrep: 搜索工具；tini: PID 1 与信号转发；
# ca-certificates: 出站 HTTPS（模型 API / 插件安装）。
# 刻意不装 bubblewrap：容器内创建命名空间通常需要额外权限，
# 装不上反而让 bwrap 路径失败；留给 Landlock 后端（无需特权）兜底。
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git bash ca-certificates curl ripgrep procps tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /opt/dsh /opt/dsh
RUN ln -sf /opt/dsh/node_modules/.bin/dsh /usr/local/bin/dsh \
 && git config --system --add safe.directory '*'

# `dsh plugin add` 会把参数转发给 profile 目录里的 pnpm，故运行期需要 pnpm 可用。
RUN if command -v corepack >/dev/null 2>&1; then \
        corepack enable && corepack prepare pnpm@11.28.5 --activate; \
    else \
        npm install -g --no-audit --no-fund pnpm@11.28.5; \
    fi

COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --chmod=0755 resolve-host.mjs /usr/local/bin/resolve-host.mjs
COPY healthcheck.mjs /usr/local/bin/healthcheck.mjs

ENV NODE_ENV=production \
    DSH_HOME=/data \
    DSH_PORT=3080 \
    LANG=C.UTF-8 \
    PATH=/opt/dsh/node_modules/.bin:$PATH

RUN useradd --create-home --uid 10001 --shell /bin/bash dsh \
 && mkdir -p /data /workspace \
 && chown -R dsh:dsh /data /workspace

USER dsh
WORKDIR /workspace
VOLUME ["/data"]
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["node", "/usr/local/bin/healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["web"]
