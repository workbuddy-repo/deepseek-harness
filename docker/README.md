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

### 方式一：docker compose（推荐）

仓库根目录的 `docker-compose.yml` 走 **host 网络**，文件里没有任何 IP，也不需要 `.env`：

| 宿主路径 | 容器路径 | 内容 |
|---|---|---|
| `./data` | `/data` | 会话日志、凭证、profile、已安装插件（`DSH_HOME`） |
| `./workspace` | `/workspace` | 工作空间，agent 读写项目的根目录 |

```bash
mkdir -p data workspace
sudo chown -R 1000:1000 data workspace     # 与 compose 里的 user 对齐
docker compose pull
docker compose up -d

docker logs dsh | grep 'token='            # 取带 token 的启动 URL
```

启动时会打印两行自检信息，出问题先看这里：

```
dsh: listen   192.168.1.13:3080
dsh: trusted  192.168.1.13 fnos localhost 127.0.0.1
```

`listen` 是自动探测到的「默认路由网卡」地址，`trusted` 是本机所有地址 + 主机名 + 回环。
宿主换 IP、换网段、换 DHCP 租约之后，`docker compose up -d` 重启一次即可，不用改文件。

只有**用域名访问**（反向代理、飞牛远程访问）时才需要补一条：

```dotenv
DSH_TRUSTED_HOSTS=dsh.example.com
```

> host 网络的两个副作用，都属于正常：
> - 飞牛面板里看不到端口映射（没有 NAT，容器直接占用宿主 3080）；
> - 在 NAS 本机上用 `localhost:3080` 连不上，请用 NAS 的局域网 IP（dsh 只绑一块具体网卡，不监听回环）。

### 方式二：docker run

```bash
docker run -d --name dsh --network host \
  -v "$PWD/data:/data" \
  -v "$PWD/workspace:/workspace" \
  -u "$(id -u):$(id -g)" \
  ghcr.io/workbuddy-repo/deepseek-harness:latest

docker logs dsh | grep 'token='    # 取带 token 的启动 URL，浏览器打开
```

环境变量、子命令透传、权限说明见下方。

### 在飞牛 fnOS 上部署

仓库根目录的 `docker-compose.yml` 已按飞牛场景设好默认值（host 网络、uid 1000、GHCR 镜像），界面里粘贴即可：

1. **Docker → Compose → 新增项目**，路径选一个空文件夹（如 `/vol1/1000/Docker/DSH`）。
2. 先用「文件管理」在该目录下建 `data`、`workspace` 两个文件夹——以自己账户创建，属主才是 1000，容器才写得进去。
3. 粘贴 compose 内容，**不用改任何 IP**。
4. 勾选「创建项目后立即启动」。

拉镜像前建议先在 SSH 里确认网络可达（ghcr.io 国内常超时）：

```bash
docker pull ghcr.io/workbuddy-repo/deepseek-harness:latest
```

起来后 `docker logs dsh | grep 'token='`，日志里打印的地址可以直接点开。

## 几个不能想当然的地方

这些都是实测踩出来的，不是推测：

| 约束 | 说明 |
|---|---|
| **`--host 0.0.0.0` 会失败** | dsh 的 HTTP 服务拒绝通配地址，只接受具体网卡字面量。所以监听地址由 `docker-entrypoint.sh` 运行时解析（`resolve-host.mjs`，默认路由网卡优先） |
| **Host 围栏与监听地址是两件事** | 页面能打开但接口 403，说明 `Host` 不在信任列表。host 网络下监听地址自动受信，故无需配置；bridge / 域名 / 反代场景才需要补 `DSH_TRUSTED_HOSTS` |
| **Node 必须 ≥ 22.19** | 入口用 `import.meta.main`；22.13 实测 `dsh --version` 无输出、退出码 0，静默失败 |
| **不需要编译工具链** | 原生模块随包提供 glibc 预编译，`npm install` 即可。因此**不要**放开 npm 的 install-scripts，那会触发 `node-gyp rebuild` 反而需要 python/g++ |
| **首次访问必须带 token** | 裸访问返回 401，容易误判成服务挂了 |
| **挂载目录权限** | 容器内以 `DSH_UID:DSH_GID`（默认 1000）运行，挂 root 拥有的目录写不进去，需 `chown -R 1000:1000` |

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PORT` | `3080` | 监听端口 |
| `DSH_BIND_ADDR` / `DSH_HOST` | 自动探测 | 一般留空。默认路由网卡的 IPv4 作为监听地址；**不要设 `0.0.0.0`** |
| `DSH_TRUSTED_HOSTS` | 空（自动） | 留空即信任本机所有 IPv4 + 主机名 + 回环；填了则**追加**，用于域名/反代，空格分隔 |
| `DSH_PUBLIC_URL` | 空 | 仅影响打印的 URL，不授予信任；留空时按监听地址生成 |
| `DSH_TLS_CERT` / `DSH_TLS_KEY` | 空 | 直连 HTTPS，必须成对 |
| `DSH_PERMISSION_MODE` | `workspace-write` | 可设 `read-only` / `danger-full-access` |
| `DSH_UID` / `DSH_GID` | `1000` | 容器运行身份，需与宿主目录属主一致 |
| `DSH_HOME` | `/data` | 会话、凭证、profile、插件 |
| `DEEPSEEK_API_KEY` | 空 | 也可在 Settings → Models 里配 |

### 子命令透传

```bash
docker run --rm -it IMAGE bash                            # 进容器
docker run --rm IMAGE --version                           # dsh 版本
docker run --rm -v "$PWD/ws:/workspace" IMAGE headless "总结这个仓库"
```

## 本地构建（可选，不走 CI）

`docker-compose.yml` 默认直接拉 CI 镜像，不参与本地构建。确实需要自己编译时：

```bash
docker build -t dsh:local --build-arg DSH_VERSION=0.2.1-rc.2 docker/
# 然后把 compose 里的 image 换成 dsh:local
```
