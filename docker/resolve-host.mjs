#!/usr/bin/env node
// 运行时解析「监听地址」和「应被信任的 authority 列表」。
//
// 为什么必须在运行时算：
//   1. dsh 的 web 服务器拒绝 0.0.0.0 / ::，只接受某块网卡的具体字面地址；
//   2. /api 的 Host 围栏要求浏览器地址栏里的 authority 出现在信任列表，
//      否则页面能打开、接口全 403。
//
// 在 `network_mode: host` 下 networkInterfaces() 返回的是宿主网卡，
// 所以宿主换 IP、换网段、换 DHCP 租约都不需要改 compose —— 这就是
// 「不固定 IP」的落点。bridge 模式下它返回容器 IP，同样能正常启动。
//
// 用法：
//   node resolve-host.mjs --bind      # 监听地址
//   node resolve-host.mjs --trusted   # 空格分隔的信任列表

import fs from 'node:fs'
import os from 'node:os'

const isIpv4 = (entry) => entry && entry.family === 'IPv4' && !entry.internal

/**
 * 默认路由的出口网卡名。
 * 多网卡（docker0 / 虚拟网桥 / 双物理口）时，只有它一定是对外可用的那块。
 * 读不到 /proc/net/route 时返回 undefined，由调用方回退到枚举顺序。
 */
export function defaultRouteInterface() {
  try {
    const lines = fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 4) continue
      const [iface, destination, , flags] = parts
      // destination 全零即默认路由；flags 的 RTF_UP(0x1) 位必须置位
      if (destination === '00000000' && (Number.parseInt(flags, 16) & 0x1) !== 0) return iface
    }
  } catch {
    // 非 Linux 或受限容器：忽略
  }
  return undefined
}

/** 所有非回环 IPv4，默认路由网卡的地址排在最前 */
export function ipv4Addresses() {
  const interfaces = os.networkInterfaces()
  const preferred = defaultRouteInterface()
  const order = [
    ...(preferred && interfaces[preferred] ? [preferred] : []),
    ...Object.keys(interfaces).filter((name) => name !== preferred),
  ]
  return order.flatMap((name) =>
    (interfaces[name] ?? []).filter(isIpv4).map((entry) => entry.address),
  )
}

/** 显式覆盖（DSH_HOST / DSH_BIND_ADDR）优先，否则取探测结果 */
export function bindAddress() {
  const explicit = (process.env.DSH_HOST ?? process.env.DSH_BIND_ADDR ?? '').trim()
  if (explicit !== '') return explicit
  return ipv4Addresses()[0] ?? '127.0.0.1'
}

/**
 * 过滤成 dsh 能接受的 bare authority。
 *
 * dsh 在加载 profile 时会逐个校验 trustedHosts，任何会被 WHATWG 改写的写法
 * （带路径、带用户名、首尾空白、补零端口、非规范 IPv6）都会让整个进程
 * 直接报错退出。所以这里先自己筛一遍，宁可少信任一个，也不让启动失败。
 */
export function validAuthorities(candidates) {
  const seen = new Set()
  const result = []
  for (const raw of candidates) {
    const entry = String(raw ?? '').trim()
    if (entry === '') continue
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    try {
      const url = new URL(`http://${entry}`)
      const canonical = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
      if (canonical !== key) continue
      seen.add(key)
      result.push(entry)
    } catch {
      // 解析不了就不加
    }
  }
  return result
}

/** 自动信任集合：本机所有 IPv4 + 主机名 + 回环 */
export function automaticAuthorities() {
  return validAuthorities([
    ...ipv4Addresses(),
    os.hostname(),
    'localhost',
    '127.0.0.1',
  ])
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('resolve-host.mjs')

if (invokedDirectly) {
  const mode = process.argv[2]
  if (mode === '--bind') {
    process.stdout.write(bindAddress())
  } else if (mode === '--trusted') {
    process.stdout.write(automaticAuthorities().join(' '))
  } else if (mode === '--filter') {
    // 过滤用户手写的 DSH_TRUSTED_HOSTS：非法项如果直接传给 dsh，
    // 会让整个 profile 加载失败（容器起不来），这里丢弃并告警。
    const raw = process.env.DSH_TRUSTED_RAW ?? ''
    const words = raw.split(/\s+/).filter((word) => word !== '')
    const kept = validAuthorities(words).map((entry) => entry.toLowerCase())
    const dropped = words.filter((word) => !kept.includes(word.toLowerCase()))
    for (const word of dropped) {
      process.stderr.write(`dsh: 忽略非法的 trusted host ${JSON.stringify(word)}（应为 host 或 host:port）\n`)
    }
    process.stdout.write(kept.join(' '))
  } else {
    process.stderr.write('usage: resolve-host.mjs --bind | --trusted | --filter\n')
    process.exit(2)
  }
}

