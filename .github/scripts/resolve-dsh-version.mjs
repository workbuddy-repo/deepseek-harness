#!/usr/bin/env node
/**
 * 决定本次要构建的 dsh 版本。
 *
 * 判定规则（按需求约定）：**只要版本号里不含 `alpha`，就视为正式版**。
 * 也就是说 `0.2.1-rc.2`、`0.3.0-beta.1` 都算正式版，只有 `0.2.1-alpha.5`
 * 这类被排除。
 *
 * 不能直接用 npm 的 `latest` dist-tag：它当前指向 0.2.1-rc.2，
 * 且随发布策略变化，不作为"是否有新版"的依据。这里扫描全部已发布版本，
 * 按 semver 取最大值（含预发布后缀的正确排序）。
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

/** 含 alpha 的版本不视为正式版，其余（含 rc / beta）都算 */
const isOfficial = (version) => !/alpha/i.test(version)

/**
 * semver 解析：拆出数字核心与预发布标识。
 * 例：0.2.1-rc.2 -> { nums: [0,2,1], pre: 'rc.2' }
 */
function parse(version) {
  const withoutBuild = version.split('+')[0]
  const dash = withoutBuild.indexOf('-')
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const pre = dash === -1 ? null : withoutBuild.slice(dash + 1)
  return { nums: core.split('.').map(Number), pre }
}

/** 按 semver 比较预发布标识；无预发布标识的优先级更高 */
function comparePre(a, b) {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1

  const left = a.split('.')
  const right = b.split('.')
  const len = Math.max(left.length, right.length)

  for (let i = 0; i < len; i += 1) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1

    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff
    } else if (xNumeric) {
      return -1
    } else if (yNumeric) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

function compare(a, b) {
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (diff !== 0) return diff
  }
  return comparePre(pa.pre, pb.pre)
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
const officialVersions = published.filter(isOfficial).sort(compare)

console.log(`已发布 ${published.length} 个版本，其中正式版（不含 alpha）${officialVersions.length} 个`)
if (officialVersions.length > 0) {
  console.log(`正式版列表：${officialVersions.join(', ')}`)
}
console.log(`当前 latest dist-tag：${meta['dist-tags']?.latest ?? '(无)'}`)

let version = REQUESTED
if (version !== '') {
  if (!published.includes(version)) {
    console.error(`版本 ${version} 在 npm 上不存在`)
    process.exit(1)
  }
  if (!isOfficial(version)) {
    console.log(`::warning::${version} 含 alpha，按手动指定继续构建，但不会更新 latest 标签`)
  }
} else {
  version = officialVersions.at(-1) ?? ''
  if (version === '') skip('当前没有非 alpha 版本，本次跳过')
}

console.log(`目标版本：${version}`)
output('version', version)
