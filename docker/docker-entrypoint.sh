#!/bin/sh
# 启动包装：把「容器里怎么监听、哪些地址算自己人」这两件事从用户手里接管。
#
# 两个硬约束都来自 dsh 自身：
#   1. web 服务器拒绝 0.0.0.0 / ::，只接受某块网卡的具体字面地址；
#   2. /api 的 Host 围栏只认「回环 / 监听地址本身 / trustedHosts 里的 authority」，
#      不匹配就 403 —— 登录页会表现为「打开就关掉」。
#
# 因此监听地址与信任列表一律在运行时算（见 resolve-host.mjs），
# compose 里不需要写任何 IP。`network_mode: host` 时探测到的就是宿主网卡，
# 宿主换 IP / 换网段后重启容器即可自动适配。
set -eu

RESOLVER=/usr/local/bin/resolve-host.mjs

# 绑定挂载最常见的失败：宿主目录属于别的 uid，容器内的非 root 用户写不进去。
# 不提前拦下来的话，表现得像"插件加载异常"，很难定位。这里直接给出可执行的修复命令。
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
export DSH_HOME

if ! mkdir -p "$DSH_HOME" 2>/dev/null || [ ! -w "$DSH_HOME" ]; then
    echo "dsh: DSH_HOME=$DSH_HOME 不可写（容器内 uid=$(id -u) gid=$(id -g)）。" >&2
    echo "     宿主目录需归属同一 uid，例如：" >&2
    echo "       sudo chown -R $(id -u):$(id -g) <宿主上的 data 目录>" >&2
    echo "     或在 compose 中设置 user: \"\$(id -u):\$(id -g)\" 对齐宿主用户。" >&2
    exit 73
fi

if [ -d /workspace ] && [ ! -w /workspace ]; then
    echo "dsh: 提示 /workspace 对 uid=$(id -u) 只读，agent 将无法写入该目录。" >&2
fi

if [ "$#" -eq 0 ]; then
    set -- web
fi

# 非 web 子命令的处理：
#   - 首个 token 是镜像里存在的可执行文件（bash/sh/git/node...）→ 直接执行，
#     保证 `docker run --rm -it IMAGE bash` 符合直觉；
#   - 否则交给 dsh（headless / sdk / acp / plugin / 自定义 profile 名）。
case "$1" in
    web)
        shift
        ;;
    *)
        if command -v "$1" >/dev/null 2>&1; then
            exec "$@"
        fi
        exec dsh "$@"
        ;;
esac

PORT="${DSH_PORT:-3080}"
HOST="$(node "$RESOLVER" --bind)"

case "$HOST" in
    0.0.0.0|::|"[::]"|"")
        echo "dsh: 解析出的监听地址 '$HOST' 不被接受：web 服务器拒绝通配地址。" >&2
        echo "     指定具体网卡地址：DSH_BIND_ADDR=192.168.1.10" >&2
        exit 64
        ;;
esac

# 自动信任：本机所有 IPv4 + 主机名 + 回环。
# DSH_TRUSTED_HOSTS 非空时与之取并集，用于补充域名（反向代理、飞牛远程访问等）。
TRUSTED="$(node "$RESOLVER" --trusted)"
if [ -n "${DSH_TRUSTED_HOSTS:-}" ]; then
    EXTRA="$(DSH_TRUSTED_RAW="$DSH_TRUSTED_HOSTS" node "$RESOLVER" --filter)"
    if [ -n "$EXTRA" ]; then
        TRUSTED="$TRUSTED $EXTRA"
    fi
fi

# 可选 flag 先拼成无空格片段；这些值本身不含空格，允许 shell 分词。
OPTIONAL=""
if [ -n "${DSH_PUBLIC_URL:-}" ]; then
    OPTIONAL="--public-url $DSH_PUBLIC_URL"
fi
for authority in $TRUSTED; do
    OPTIONAL="$OPTIONAL --trusted-host $authority"
done
if [ -n "${DSH_TLS_CERT:-}" ] && [ -n "${DSH_TLS_KEY:-}" ]; then
    OPTIONAL="$OPTIONAL --tls-cert $DSH_TLS_CERT --tls-key $DSH_TLS_KEY"
fi

# 一次成型：位置参数追加在最后，避免前面多次 set -- 丢掉用户参数
# shellcheck disable=SC2086
set -- web --host "$HOST" --port "$PORT" --no-open $OPTIONAL "$@"

echo "dsh: listen   ${HOST}:${PORT}"
echo "dsh: trusted  ${TRUSTED}"
echo "dsh: paths    workspace=$(pwd) home=$DSH_HOME"
exec dsh "$@"
