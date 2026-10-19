# dsh Docker 镜像（自动化构建）

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打包成可直接运行的 Docker 镜像。本仓库不改动上游任何源码，`docker/` 下的文件全部是新增的——它只负责镜像与发布流水线。

**本仓库完全由 AI 创作**：Dockerfile、启动脚本、健康检查、CI 流水线与文档均由 AI 完成。

流水线定时检查 `@deepseek-ai/dsh` 是否发布了新的正式版，一有就自动构建镜像并推送到 GitHub Container Registry。

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

仓库根目录的 `docker-compose.yml` 已经配好两个持久化映射：

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

路径与地址可以用 `.env` 覆盖，不必改 compose：

```dotenv
DSH_LAN_ADDR=192.168.1.13
DSH_PORT=3080
DEEPSEEK_API_KEY=sk-xxx
```

> **`DSH_LAN_ADDR` 必须填 NAS 的局域网 IP**，且浏览器必须用同一个 IP 访问。
> dsh 的 Host 围栏是精确匹配：写成 `192.168.1.13`，用 `192.168.1.20` 或别的主机名访问都会 403。
> 端口映射把请求转发进容器时会原样保留 `Host` 头，所以这一步绕不过去。

### 方式二：docker run

```bash
docker run -d --name dsh -p 3080:3080 \
  -e DSH_TRUSTED_HOSTS=192.168.1.13 \
  -e DSH_PUBLIC_URL=http://192.168.1.13:3080/ \
  -v "$PWD/data:/data" \
  -v "$PWD/workspace:/workspace" \
  -u "$(id -u):$(id -g)" \
  ghcr.io/workbuddy-repo/deepseek-harness:latest

docker logs dsh | grep 'token='    # 取带 token 的启动 URL，浏览器打开
```

环境变量、子命令透传、权限说明见下方。

### 在飞牛 fnOS 上部署

仓库根目录的 `docker-compose.yml` 已按飞牛场景设好默认值（bridge + 端口映射、uid 1000、GHCR 镜像）：

1. **Docker → Compose → 新增项目**，路径选一个空文件夹（如 `/vol1/1000/Docker/DSH`）。
2. 先用「文件管理」在该目录下建 `data`、`workspace` 两个文件夹——以自己账户创建，属主才是 1000，容器才写得进去。
3. 粘贴 compose 内容，把 `192.168.1.100` 全部换成 NAS 的局域网 IP。
4. 勾选「创建项目后立即启动」。

拉镜像前建议先在 SSH 里确认网络可达（ghcr.io 国内常超时）：

```bash
docker pull ghcr.io/workbuddy-repo/deepseek-harness:latest
```

起来后取登录地址：

```bash
docker logs dsh | grep 'token='
```

**首次进入必须用这条带 `?token=` 的完整链接。** 直接敲 `http://IP:3080`、或用飞牛面板的「访问」按钮（只拼 `IP:端口`，不带 token）都会得到 401，页面表现为白屏或一闪而过。登录成功后 cookie 会记住这次会话，之后用裸地址就正常了。

容器每次重建 token 都会变，旧链接、旧书签随之失效。

## 几个不能想当然的地方

这些都是实测踩出来的，不是推测：

| 约束 | 说明 |
|---|---|
| **`--host 0.0.0.0` 会失败** | dsh 的 HTTP 服务拒绝通配地址，只接受具体网卡字面量。容器 IP 运行时才定，所以由 `docker-entrypoint.sh` 解析后注入 |
| **401 和 403 是两件事** | `401`＝没登录（缺 token 或 cookie），`403`＝Host 不在信任列表。登录页一闪而过多半是 403，白屏才是 401 |
| **Host 围栏是精确匹配** | `DSH_TRUSTED_HOSTS=*` 不会通配（能通过启动校验，但匹配不到任何地址，等于没配）。IP 换了就要改配置 |
| **Node 必须 ≥ 22.19** | 入口用 `import.meta.main`；22.13 实测 `dsh --version` 无输出、退出码 0，静默失败 |
| **不需要编译工具链** | 原生模块随包提供 glibc 预编译，`npm install` 即可。因此**不要**放开 npm 的 install-scripts，那会触发 `node-gyp rebuild` 反而需要 python/g++ |
| **挂载目录权限** | 容器内以 `DSH_UID:DSH_GID`（默认 1000）运行，挂 root 拥有的目录写不进去，需 `chown -R 1000:1000` |

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PORT` | `3080` | 监听端口 |
| `DSH_HOST` | 自动探测 | 一般留空（取容器第一个非回环 IPv4）；**不要设 `0.0.0.0`** |
| `DSH_TRUSTED_HOSTS` | `localhost 127.0.0.1` | 空格分隔的 authority 白名单，必须包含浏览器访问用的 IP 或域名；不带端口＝任意端口 |
| `DSH_PUBLIC_URL` | 空 | 仅影响打印的 URL，不授予信任 |
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

## 排障顺序

按这个顺序查，每一步都能把范围砍一半：

```bash
# 1. 端口是否通（000 = 没监听）
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: 192.168.1.13:3080' http://127.0.0.1:3080/api/directoryPicker/list

# 2. 401 正常、403 说明白名单没写对
docker exec dsh printenv | grep DSH_TRUSTED

# 3. 拿最新 token 看服务端链路（303 + set-cookie 才对）
U=$(docker logs dsh 2>&1 | grep -o 'http://[^ ]*token=[A-Za-z0-9_-]*' | tail -1); echo "$U"
curl -s -o /dev/null -D - -c /tmp/j -b /tmp/j "$U" | grep -Ei '^HTTP/|^location|^set-cookie'
```

## 本地构建（可选，不走 CI）

`docker-compose.yml` 默认直接拉 CI 镜像，不参与本地构建。确实需要自己编译时：

```bash
docker build -t dsh:local --build-arg DSH_VERSION=0.2.1-rc.2 docker/
# 然后把 compose 里的 image 换成 dsh:local
```
