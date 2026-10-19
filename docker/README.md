# dsh Docker 镜像（自动化构建）

本 fork 在原仓库基础上加了**一条自动构建流水线**：定时检查 `@deepseek-ai/dsh` 是否发布了新的正式版，一有就自动构建镜像并推送到 GitHub Container Registry。

原仓库没有 Dockerfile，`docker/` 下的文件是本 fork 新增的，不改动上游任何源码。

## 自动化怎么工作

```
定时触发（每 6 小时）或手动触发
        │
        ▼
解析版本 ── 扫描 npm registry 全部版本，排除含 alpha 的，其余按 semver 取最大
        │   ↳ 即 rc / beta 也算正式版；不看 latest dist-tag（发布策略会变）
        ▼
判断是否已构建 ── 查 ghcr.io/<owner>/deepseek-harness:<version> 是否已存在
        │
        ▼
构建并推送 ── 不含 alpha 的版本同时更新 :latest
        │
        ▼
冒烟验证 ── 起容器 → 等带 token 的启动 URL → 带 cookie 登录 → 断言 200；无 token 断言 401
        │
        ▼
打 git tag dsh-v<version> 记录已构建版本
```

工作流文件：`.github/workflows/dsh-docker-release.yml`
版本解析脚本：`.github/scripts/resolve-dsh-version.mjs`

### 首次启用

1. 进入 fork 的 **Actions** 标签页，启用 workflows（fork 的定时工作流默认是关闭的）。
2. 需要时手动跑一次验证：**Actions → dsh → Docker 镜像（正式版自动构建）→ Run workflow**，版本留空即用自动探测。
3. 推送的镜像默认是私有的。要公开：**Packages → deepseek-harness → Package settings → Change visibility**。

### 手动触发参数

| 参数 | 说明 |
|---|---|
| `version` | 指定版本，如 `0.2.1-rc.2`；留空自动探测正式版 |
| `force` | 镜像已存在也重建 |

## 镜像怎么用

```bash
docker pull ghcr.io/<owner>/deepseek-harness:latest

docker run -d --name dsh -p 3080:3080 \
  -v dsh-home:/data \
  -v "$PWD/workspace:/workspace" \
  ghcr.io/<owner>/deepseek-harness:latest

docker logs dsh | grep 'token='    # 取带 token 的启动 URL，浏览器打开
```

环境变量、子命令透传、权限说明见下方。

## 几个不能想当然的地方

这些都是实测踩出来的，不是推测：

| 约束 | 说明 |
|---|---|
| **`--host 0.0.0.0` 会失败** | dsh 的 HTTP 服务拒绝通配地址，只接受具体网卡字面量。容器 IP 运行时才定，所以由 `docker-entrypoint.sh` 解析后注入 |
| **Node 必须 ≥ 22.19** | 入口用 `import.meta.main`；22.13 实测 `dsh --version` 无输出、退出码 0，静默失败 |
| **不需要编译工具链** | 原生模块随包提供 glibc 预编译，`npm install` 即可。因此**不要**放开 npm 的 install-scripts，那会触发 `node-gyp rebuild` 反而需要 python/g++ |
| **首次访问必须带 token** | 裸访问返回 401，容易误判成服务挂了 |
| **局域网/域名访问要 `--trusted-host`** | 否则页面能开、接口全 403 |
| **挂载目录权限** | 容器内 uid 10001，挂 root 拥有的目录写不进去，需 `chown -R 10001:10001` |

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PORT` | `3080` | 监听端口 |
| `DSH_HOST` | 自动探测 | 留空即可；`--network host` 下可设 `127.0.0.1`；**不要设 `0.0.0.0`** |
| `DSH_TRUSTED_HOSTS` | 空 | 空格分隔，如 `dsh.example.com 192.168.1.20:3080` |
| `DSH_PUBLIC_URL` | 空 | 仅影响打印的 URL，不授予信任 |
| `DSH_TLS_CERT` / `DSH_TLS_KEY` | 空 | 直连 HTTPS，必须成对 |
| `DSH_PERMISSION_MODE` | `workspace-write` | 可设 `read-only` / `danger-full-access` |
| `DSH_HOME` | `/data` | 会话、凭证、profile、插件 |
| `DEEPSEEK_API_KEY` | 空 | 也可在 Settings → Models 里配 |

### 子命令透传

```bash
docker run --rm -it IMAGE bash                            # 进容器
docker run --rm IMAGE --version                           # dsh 版本
docker run --rm -v "$PWD/ws:/workspace" IMAGE headless "总结这个仓库"
```

## 本地构建（不走 CI）

```bash
docker build -t dsh:local --build-arg DSH_VERSION=0.2.1-rc.2 docker/
# 或
cd docker && docker compose up -d
```
