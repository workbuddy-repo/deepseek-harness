#!/usr/bin/env node
/**
 * 决定本次要构建的 dsh 版本。
 *
 * 关键点：npm 上 `latest` dist-tag **当前指向 0.2.1-rc.2 这类预发布版本**，
 * 所以不能拿 dist-tag 当"正式版"依据。这里改成扫描全部已发布版本，
 * 只保留严格的 x.y.z（无预发布后缀），取最大者。
 *
 * 输入（环境变量）：
 *   REQUESTED_VERSION  手动指定版本；留空则自动探测
 * 输出（写入 $GITHUB_OUTPUT）：
 *   version  目标版本，空字符串表示无需构建
 */
import { appendFileSync } from 'node:fs'

const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai/dsh'
const REQUESTED = (process.env.REQUESTED_VERSION ?? '').trim()

const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)

/** 严格正式版：不带 -rc / -alpha / +build 等后缀 */
const STABLE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const isStable = (version) => STABLE_PATTERN.test(version)

function compare(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function skip(reason) {
  console.log(`::notice::${reason}`)
  output('version', '')
  process.exit(0)
}

let meta
try {
  const response = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  meta = await response.json()
} catch (error) {
  console.error(`读取 npm registry 失败：${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const published = Object.keys(meta.versions ?? {})
const stableVersions = published.filter(isStable).sort(compare)

console.log(`已发布 ${published.length} 个版本，其中正式版 ${stableVersions.length} 个`)
if (stableVersions.length > 0) {
  console.log(`正式版列表：${stableVersions.join(', ')}`)
}
console.log(`当前 latest dist-tag：${meta['dist-tags']?.latest ?? '(无)'}`)

let version = REQUESTED
if (version !== '') {
  if (!published.includes(version)) {
    console.error(`版本 ${version} 在 npm 上不存在`)
    process.exit(1)
  }
  if (!isStable(version)) {
    console.log(`::warning::${version} 是预发布版本，按手动指定继续构建（不会打 latest 标签）`)
  }
} else {
  version = stableVersions.at(-1) ?? ''
  if (version === '') skip('当前没有正式版本，只有预发布版本，本次跳过')
}

console.log(`目标版本：${version}`)
output('version', version)
