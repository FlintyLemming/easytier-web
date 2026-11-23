// Feasibility gate for upgrading easytier-web to v2.7.1 while devices stay on 2.6.4.
// Run after `bash testenv/upgrade.sh v2.6.4 v2.7.1`:  node testenv/gate-check.ts
// Writes testenv/reports/gate-<YYYY-MM-DD>.md (first line `GATE: PASS` / `GATE: FAIL`).
// Exit code: 0 on PASS, 1 on FAIL.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, EtApiError, MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const here = dirname(fileURLToPath(import.meta.url))
const stateFile = join(here, 'data', 'seed-state.json')

const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const reportFile = join(here, 'reports', `gate-${today}.md`)

const MAX_RAW = 2048
const NAMES = ['core1', 'core2', 'core3'] as const

// ---------- API wrapper that remembers the last raw response ----------

interface LastResponse {
  req: string
  status: number | '2xx' // EtApi does not expose the success status code
  body: string
}
let last: LastResponse | undefined

const api = new EtApi(base)

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const req = `${method} ${path}`
  try {
    let r: T
    if (method === 'GET') r = await api.get<T>(path)
    else if (method === 'POST') r = await api.post<T>(path, body)
    else if (method === 'PUT') r = await api.put<T>(path, body)
    else if (method === 'PATCH') r = await api.patch<T>(path, body)
    else r = await api.del<T>(path)
    last = { req, status: '2xx', body: r === undefined ? '' : typeof r === 'string' ? r : JSON.stringify(r) }
    return r
  } catch (e) {
    if (e instanceof EtApiError) last = { req, status: e.status, body: e.body }
    else last = { req, status: 0, body: e instanceof Error ? e.message : String(e) }
    throw e
  }
}

// ---------- response shapes (as observed) ----------

type Id = UuidParts | string
const idStr = (i: Id | null | undefined) => (i == null ? '' : typeof i === 'string' ? i.toLowerCase() : uuidToStr(i))

interface MachineItem {
  online?: boolean
  last_seen?: string | null
  info?: { machine_id?: Id; hostname?: string; easytier_version?: string } | null
}
interface InstList {
  running_inst_ids?: Id[]
  disabled_inst_ids?: Id[]
}
interface RunInfo {
  info?: { map?: Record<string, { running?: boolean; error_msg?: string | null }> }
}
interface NetworkDetail {
  network_id: string
  network_name?: string
  display_name?: string
}
interface Member {
  device_id: string
  hostname?: string | null
  online?: boolean
  running?: boolean | null
  version?: string | null
  runtime_virtual_ipv4?: string | null
  error_msg?: string | null
  has_override?: boolean
}
interface Route {
  hostname?: string
  peer_id?: number
  version?: string
}

// ---------- check bookkeeping ----------

class CheckFail extends Error {}

interface Result {
  id: string
  title: string
  pass: boolean
  evidence: string[]
  reason?: string
  raw?: LastResponse
}
const results: Result[] = []

async function check(id: string, title: string, requires: string[], fn: (ev: string[]) => Promise<void>): Promise<boolean> {
  const evidence: string[] = []
  const failedDeps = requires.filter((r) => !results.find((x) => x.id === r)?.pass)
  if (failedDeps.length) {
    results.push({ id, title, pass: false, evidence, reason: `not run: ${failedDeps.join(', ')} failed` })
    console.log(`${id} FAIL (not run: ${failedDeps.join(', ')} failed)`)
    return false
  }
  last = undefined
  const t0 = Date.now()
  try {
    await fn(evidence)
    evidence.push(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    results.push({ id, title, pass: true, evidence })
    console.log(`${id} PASS`)
    return true
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    evidence.push(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    results.push({ id, title, pass: false, evidence, reason, raw: last })
    console.log(`${id} FAIL: ${reason.replace(/\s+/g, ' ').slice(0, 300)}`)
    return false
  }
}

function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new CheckFail(msg)
}

// Like waitFor, but the poll function returns [done, statusLine]; on timeout the
// last status line is included in the error.
async function poll(timeoutMs: number, label: string, fn: () => Promise<[boolean, string]>): Promise<{ status: string; ms: number }> {
  const t0 = Date.now()
  let status = 'no response yet'
  try {
    await waitFor(
      async () => {
        const [done, s] = await fn()
        status = s
        return done ? true : undefined
      },
      timeoutMs,
      label,
    )
  } catch (e) {
    throw new CheckFail(`${e instanceof Error ? e.message : String(e)}; last state: ${status}`)
  }
  return { status, ms: Date.now() - t0 }
}

// ---------- helpers ----------

const seed = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, { home: string; lab?: string }>

async function instIds(machine: string): Promise<{ running: string[]; disabled: string[] }> {
  const r = await call<InstList>('GET', `/machines/${machine}/networks`)
  return { running: (r.running_inst_ids ?? []).map(idStr), disabled: (r.disabled_inst_ids ?? []).map(idStr) }
}

async function instRunning(machine: string, inst: string): Promise<{ running: boolean; error?: string | null }> {
  const r = await call<RunInfo>('GET', `/machines/${machine}/networks/info/${inst}`)
  const i = r.info?.map?.[inst]
  return { running: i?.running === true, error: i?.error_msg }
}

async function homesRunning(): Promise<[boolean, string]> {
  const parts: string[] = []
  let ok = true
  for (const name of NAMES) {
    const m = MACHINES[name]
    const home = seed[m]!.home
    const s = await instRunning(m, home)
    if (!s.running) ok = false
    parts.push(`${name} home ${home} running=${s.running}${s.error ? ` error=${s.error}` : ''}`)
  }
  return [ok, parts.join('; ')]
}

function dockerImages(): string {
  try {
    return execFileSync('docker', ['compose', '-f', join(here, 'docker-compose.yml'), 'ps', '--format', '{{.Service}}={{.Image}}'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .join(', ')
  } catch (e) {
    return `unavailable (${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------- checks ----------

const preamble: string[] = []
let networkId: string | undefined

await check('G1', '登录', [], async (ev) => {
  await waitForApi(api)
  try {
    await api.login('admin', 'admin')
  } catch (e) {
    if (e instanceof EtApiError) last = { req: 'POST /auth/login', status: e.status, body: e.body }
    throw e
  }
  await call('GET', '/auth/check_login_status')
  ev.push(`login('admin','admin') 成功；GET /auth/check_login_status → 2xx ${last?.body ?? ''}`.trim())
})

await check('G2', '模式（webhook_auth === false）', ['G1'], async (ev) => {
  const r = await call<{ webhook_auth?: unknown }>('GET', '/console-info')
  ev.push(`GET /console-info → \`${JSON.stringify(r)}\``)
  must(r.webhook_auth === false, `webhook_auth is ${JSON.stringify(r.webhook_auth)}, expected false`)
})

await check('G3', '设备登记（90s 内三台 online）', ['G1'], async (ev) => {
  const { status, ms } = await poll(90_000, 'core1..3 online', async () => {
    const r = await call<{ machines: MachineItem[] }>('GET', '/machines')
    const parts: string[] = []
    let ok = true
    for (const name of NAMES) {
      const m = r.machines.find((x) => idStr(x.info?.machine_id) === MACHINES[name])
      if (!m) {
        ok = false
        parts.push(`${name} missing`)
        continue
      }
      if (m.online !== true) ok = false
      parts.push(
        `${name} online=${JSON.stringify(m.online)} hostname=${m.info?.hostname ?? '?'} version=${m.info?.easytier_version ?? '?'}`,
      )
    }
    return [ok, parts.join('; ')]
  })
  ev.push(`GET /machines（${(ms / 1000).toFixed(1)}s 后满足）：${status}`)
})

await check('G4', '旧实例保留', ['G1'], async (ev) => {
  ev.push(`seed-state.json: \`${JSON.stringify(seed)}\``)
  for (const name of NAMES) must(seed[MACHINES[name]]?.home, `seed-state.json has no home instance for ${name}`)
  must(seed[MACHINES.core2]?.lab, 'seed-state.json has no lab instance for core2')
  const { status, ms } = await poll(60_000, 'legacy instances present, home running, lab disabled', async () => {
    const parts: string[] = []
    let ok = true
    for (const name of NAMES) {
      const m = MACHINES[name]
      const s = seed[m]!
      const ids = await instIds(m)
      const all = new Set([...ids.running, ...ids.disabled])
      const missing = [s.home, ...(s.lab ? [s.lab] : [])].filter((i) => !all.has(i))
      if (missing.length) ok = false
      const home = await instRunning(m, s.home)
      if (!home.running) ok = false
      let lab = ''
      if (name === 'core2' && s.lab) {
        const labDisabled = ids.disabled.includes(s.lab) && !ids.running.includes(s.lab)
        if (!labDisabled) ok = false
        lab = ` lab ${s.lab} in disabled_inst_ids=${ids.disabled.includes(s.lab)} in running_inst_ids=${ids.running.includes(s.lab)}`
      }
      parts.push(
        `${name}: running_inst_ids=[${ids.running.join(',')}] disabled_inst_ids=[${ids.disabled.join(',')}]` +
          `${missing.length ? ` MISSING=[${missing.join(',')}]` : ''} home running=${home.running}${home.error ? ` error=${home.error}` : ''}${lab}`,
      )
    }
    return [ok, parts.join('; ')]
  })
  ev.push(`${(ms / 1000).toFixed(1)}s 后满足`)
  for (const p of status.split('; ')) ev.push(p)
  ev.push('停用状态字段：`GET /machines/{id}/networks` 的 `disabled_inst_ids`（运行中的在 `running_inst_ids`）')
})

await check('G5', '中央网络能在 2.6.4 core 上运行', ['G1'], async (ev) => {
  // Hygiene: remove a "gate" network left over from an earlier aborted run.
  const existing = await call<{ networks: NetworkDetail[] }>('GET', '/networks')
  for (const n of existing.networks ?? []) {
    if (n.network_name === 'gate' || n.display_name === 'gate') {
      await call('DELETE', `/networks/${n.network_id}`)
      preamble.push(`运行前删除了上次遗留的 gate 网络 ${n.network_id}`)
    }
  }

  const created = await call<NetworkDetail>('POST', '/networks', {
    settings: {
      display_name: 'gate',
      network_name: 'gate',
      networking_method: 'Manual',
      peer_urls: ['tcp://core2:11030'],
      virtual_cidr: '10.155.0.0/24',
    },
    network_secret: 'gate-secret',
  })
  must(created?.network_id, `POST /networks returned no network_id`)
  networkId = created.network_id.toLowerCase()
  ev.push(`1. POST /networks → network_id=${networkId}；响应 \`${JSON.stringify(created).slice(0, 400)}\``)

  await call('POST', `/networks/${networkId}/members`, { device_ids: [MACHINES.core2, MACHINES.core3] })
  ev.push(`2. POST /networks/{id}/members {device_ids:[core2,core3]} → ${last?.status}${last?.body ? ` ${last.body}` : '（空响应体）'}`)

  const listeners: Record<'core2' | 'core3', string[]> = {
    core2: ['tcp://0.0.0.0:11030', 'udp://0.0.0.0:11030'],
    core3: ['tcp://0.0.0.0:11040', 'udp://0.0.0.0:11040'],
  }
  for (const name of ['core2', 'core3'] as const) {
    const r = await call<Member>('PUT', `/networks/${networkId}/members/${MACHINES[name]}/config`, {
      config: { listener_urls: listeners[name] },
    })
    ev.push(`3. PUT members/${name}/config listener_urls=${JSON.stringify(listeners[name])} → has_override=${r?.has_override}`)
  }

  const members = await poll(120_000, 'core2 and core3 members running', async () => {
    const r = await call<{ members: Member[] }>('GET', `/networks/${networkId}/members`)
    const parts: string[] = []
    let ok = true
    for (const name of ['core2', 'core3'] as const) {
      const m = (r.members ?? []).find((x) => x.device_id?.toLowerCase() === MACHINES[name])
      if (!m) {
        ok = false
        parts.push(`${name} not a member`)
        continue
      }
      if (m.running !== true) ok = false
      parts.push(
        `${name} running=${JSON.stringify(m.running)} online=${m.online} version=${m.version} ip=${m.runtime_virtual_ipv4} error=${m.error_msg}`,
      )
    }
    return [ok, parts.join('; ')]
  })
  ev.push(`4. GET /networks/{id}/members（${(members.ms / 1000).toFixed(1)}s 后满足）：${members.status}`)

  const routes = await poll(120_000, 'core2 route to core3 in gate network', async () => {
    const r = await call<{ routes?: Route[] }>('POST', `/machines/${MACHINES.core2}/proxy-rpc`, {
      service_name: 'api.instance.PeerManageRpcService',
      method_name: 'list_route',
      payload: { instance: { id: strToUuid(networkId!) } },
    })
    const hosts = (r.routes ?? []).map((x) => `${x.hostname}(${x.version ?? '?'})`)
    return [(r.routes ?? []).some((x) => x.hostname === 'core3'), `routes=[${hosts.join(', ')}]`]
  })
  ev.push(`5. core2 proxy-rpc list_route（${(routes.ms / 1000).toFixed(1)}s 后满足）：${routes.status}`)
})

await check('G6', '清理和回归', ['G1'], async (ev) => {
  must(networkId, 'G5 did not create a network, nothing to delete')
  await call('DELETE', `/networks/${networkId}`)
  ev.push(`DELETE /networks/${networkId} → ${last?.status}${last?.body ? ` ${last.body}` : '（空响应体）'}`)
  const gone = await poll(60_000, 'gate instance removed from core2 and core3', async () => {
    const parts: string[] = []
    let ok = true
    for (const name of ['core2', 'core3'] as const) {
      const ids = await instIds(MACHINES[name])
      const present = ids.running.includes(networkId!) || ids.disabled.includes(networkId!)
      if (present) ok = false
      parts.push(`${name} has ${networkId}=${present} (running=[${ids.running.join(',')}] disabled=[${ids.disabled.join(',')}])`)
    }
    return [ok, parts.join('; ')]
  })
  ev.push(`实例消失（${(gone.ms / 1000).toFixed(1)}s 后满足）：${gone.status}`)
  const [ok, homes] = await homesRunning()
  ev.push(`home 实例：${homes}`)
  must(ok, `home instances not all running: ${homes}`)
})

// ---------- report ----------

const pass = results.every((r) => r.pass)
const lines: string[] = []
lines.push(pass ? 'GATE: PASS' : 'GATE: FAIL')
lines.push('')
lines.push(`# EasyTier web v2.7.1 可行性关卡报告（${today}）`)
lines.push('')
lines.push(`- 时间：${now.toISOString()}`)
lines.push(`- API：${base}`)
lines.push(`- 容器镜像：${dockerImages()}`)
for (const p of preamble) lines.push(`- ${p}`)
lines.push('')
lines.push('| 检查 | 结果 |')
lines.push('| --- | --- |')
for (const r of results) lines.push(`| ${r.id} ${r.title} | ${r.pass ? 'PASS' : 'FAIL'} |`)
lines.push('')
for (const r of results) {
  lines.push(`## ${r.id} ${r.title}: ${r.pass ? 'PASS' : 'FAIL'}`)
  lines.push('')
  for (const e of r.evidence) lines.push(`- ${e}`)
  if (!r.pass) {
    const reason = (r.reason ?? '').replace(/\s+/g, ' ').trim()
    lines.push(`- 失败原因：${reason.length > 500 ? `${reason.slice(0, 500)}…` : reason}`)
    if (r.raw) {
      const body = r.raw.body.length > MAX_RAW ? `${r.raw.body.slice(0, MAX_RAW)}…(truncated)` : r.raw.body
      lines.push(`- 最后一次原始响应（\`${r.raw.req}\` → HTTP ${r.raw.status}，截断到 2KB）：`)
      lines.push('')
      lines.push('```')
      lines.push(body)
      lines.push('```')
    }
  }
  lines.push('')
}

mkdirSync(dirname(reportFile), { recursive: true })
writeFileSync(reportFile, lines.join('\n'))
console.log(lines[0])
console.log(`report: ${reportFile}`)
process.exit(pass ? 0 : 1)
