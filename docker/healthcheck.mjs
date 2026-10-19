// 健康检查：直接对监听地址做 TCP 连接。
//
// 不对 HTTP 状态码做断言 —— 未携带启动 token 的请求本来就会被鉴权挡下（401/403），
// 用 TCP 可连通性判断「服务已起来」更准确。
//
// 监听地址必须和入口脚本算出来的一致：dsh 只绑一块具体网卡，
// 在 host 网络下那是宿主 LAN 地址而不是 127.0.0.1，写死回环会永远 unhealthy。
import net from 'node:net'

import { bindAddress } from './resolve-host.mjs'

const port = Number(process.env.DSH_PORT ?? 3080)
const host = bindAddress()
const socket = net.connect({ port, host })

const fail = () => process.exit(1)
socket.setTimeout(3000)
socket.on('connect', () => {
  socket.end()
  process.exit(0)
})
socket.on('timeout', fail)
socket.on('error', fail)
