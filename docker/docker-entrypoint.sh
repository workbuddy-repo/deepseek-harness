#!/bin/sh
# 启动包装：把「容器里怎么监听」这件事从用户手里接管。
#
# 核心问题：dsh 的 web 服务器在加载时直接拒绝未指定地址（0.0.0.0 / ::），
# 只接受「本机某个具体接口的字面地址」。容器 IP 是运行时才确定的，
# 所以必须在 entrypoint 里解析后注入 --host。
set -eu

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

resolve_host() {
    if [ -n "${DSH_HOST:-}" ]; then
        printf '%s' "$DSH_HOST"
        return
    fi
    node -e '
        const os = require("node:os")
        const addr = Object.values(os.networkInterfaces()).flat()
            .find((i) => i && i.family === "IPv4" && !i.internal)
        process.stdout.write(addr ? addr.address : "127.0.0.1")
    '
}

HOST="$(resolve_host)"

case "$HOST" in
    0.0.0.0|::|"[::]"|"")
        echo "dsh: DSH_HOST='$HOST' 不被接受：web 服务器拒绝通配地址。" >&2
        echo "     留空即可自动探测容器 IP；--network host 下可设为 127.0.0.1。" >&2
        exit 64
        ;;
esac

# 可选 flag 先拼成无空格片段；这些值本身不含空格，允许 shell 分词。
OPTIONAL=""
[ -n "${DSH_PUBLIC_URL:-}" ] && OPTIONAL="--public-url $DSH_PUBLIC_URL"
if [ -n "${DSH_TRUSTED_HOSTS:-}" ]; then
    for authority in $DSH_TRUSTED_HOSTS; do
        OPTIONAL="$OPTIONAL --trusted-host $authority"
    done
fi
if [ -n "${DSH_TLS_CERT:-}" ] && [ -n "${DSH_TLS_KEY:-}" ]; then
    OPTIONAL="$OPTIONAL --tls-cert $DSH_TLS_CERT --tls-key $DSH_TLS_KEY"
fi

# 一次成型：位置参数追加在最后，避免前面多次 set -- 丢掉用户参数
# shellcheck disable=SC2086
set -- web --host "$HOST" --port "$PORT" --no-open $OPTIONAL "$@"

echo "dsh: listening on ${HOST}:${PORT} (workspace: $(pwd), home: ${DSH_HOME:-$HOME/.dsh})"
exec dsh "$@"
