// 健康检查：直接对监听地址做 TCP 连接。
// 不对 HTTP 状态码做断言 —— 未携带启动 token 的请求本来就会被鉴权挡下（403），
// 用 TCP 可连通性判断「服务已起来」更准确。
import net from 'node:net'
import os from 'node:os'

function resolveHost() {
  if (process.env.DSH_HOST) return process.env.DSH_HOST
  const addr = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  return addr ? addr.address : '127.0.0.1'
}

const port = Number(process.env.DSH_PORT ?? 3080)
const socket = net.connect({ port, host: resolveHost() })

const fail = () => process.exit(1)
socket.setTimeout(3000)
socket.on('connect', () => {
  socket.end()
  process.exit(0)
})
socket.on('timeout', fail)
socket.on('error', fail)
