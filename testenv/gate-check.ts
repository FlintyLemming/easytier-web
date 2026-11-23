// Feasibility gate for upgrading easytier-web to v2.7.1 while devices stay on 2.6.4.
// Run after `bash testenv/upgrade.sh v2.6.4 v2.7.1`:  node testenv/gate-check.ts
// Writes testenv/reports/gate-<YYYY-MM-DD>.md (first line `GATE: PASS` / `GATE: FAIL`).
// Exit code: 0 on PASS, 1 on FAIL.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, EtApiError, MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const here = dirname(fileURLToPath(import.meta.url))
const composeFile = join(here, 'docker-compose.yml')
// Written by seed-legacy.ts on web 2.6.4 (both are copied into the upgrade backup with the DB).
const stateFile = join(here, 'data', 'seed-state.json')
const snapshotFile = join(here, 'data', 'seed-snapshot.json')

const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const reportFile = join(here, 'reports', `gate-${today}.md`)

const MAX_RAW = 2048
const GATE_CIDR = '10.155.0.0/24'
// Everything from this line on in an existing report is kept when the report is regenerated.
const MANUAL_MARKER = '<!-- manual notes below are preserved by gate-check -->'
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
  // inst_id: random per core heartbeat session, i.e. changes when the core process restarts.
  info?: { machine_id?: Id; inst_id?: Id | null; hostname?: string; easytier_version?: string } | null
}
// running_inst_ids: running on the core now. disabled_inst_ids: stored by the web but NOT
// running on the core (upstream computes it as stored configs minus the core's running list),
// so it holds disabled configs and also enabled ones that have not been (re)delivered yet.
interface InstList {
  running_inst_ids?: Id[]
  disabled_inst_ids?: Id[]
}
interface RunInfo {
  info?: { map?: Record<string, { running?: boolean; error_msg?: string | null; routes?: Route[] }> }
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
  // Observed: {"address":{"addr":177246209},"network_length":24}; addr is the IPv4 as a big-endian u32.
  ipv4_addr?: { address?: { addr?: number }; network_length?: number } | null
}

function routeIpv4(r: Route): string | undefined {
  const a = r.ipv4_addr?.address?.addr
  if (typeof a !== 'number') return undefined
  return [24, 16, 8, 0].map((s) => (a >>> s) & 255).join('.')
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const toInt = (v: string) => v.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0)
  const [net, len] = cidr.split('/')
  const mask = Number(len) === 0 ? 0 : (0xffffffff << (32 - Number(len))) >>> 0
  return ((toInt(ip) & mask) >>> 0) === ((toInt(net!) & mask) >>> 0)
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

type Seed = Record<string, { home: string; lab?: string }>
// Loaded inside G4 (not at module load) so a missing file is a FAIL row with a reason, not a crash.
let seed: Seed | undefined

function readJsonFile<T>(file: string, hint: string): T {
  const shown = relative(process.cwd(), file) || file
  if (!existsSync(file)) throw new CheckFail(`${shown} not found: ${hint}`)
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (e) {
    throw new CheckFail(`${shown} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
}
const SEED_HINT = 'run `node testenv/seed-legacy.ts` on web v2.6.4 before upgrading'

// show_node_info via proxy-rpc; returns the TOML config the core is running.
async function nodeToml(machine: string, inst: string): Promise<string | undefined> {
  const r = await call<{ node_info?: { config?: string } }>('POST', `/machines/${machine}/proxy-rpc`, {
    service_name: 'api.instance.PeerManageRpcService',
    method_name: 'show_node_info',
    payload: { instance: { id: strToUuid(inst) } },
  })
  return r?.node_info?.config
}

async function instIds(machine: string): Promise<{ running: string[]; storedNotRunning: string[] }> {
  const r = await call<InstList>('GET', `/machines/${machine}/networks`)
  return { running: (r.running_inst_ids ?? []).map(idStr), storedNotRunning: (r.disabled_inst_ids ?? []).map(idStr) }
}

async function instRunning(
  machine: string,
  inst: string,
): Promise<{ running: boolean; error?: string | null; routeHosts: string[] }> {
  const r = await call<RunInfo>('GET', `/machines/${machine}/networks/info/${inst}`)
  const i = r.info?.map?.[inst]
  return { running: i?.running === true, error: i?.error_msg, routeHosts: (i?.routes ?? []).map((x) => x.hostname ?? '?') }
}

async function homesRunning(): Promise<[boolean, string]> {
  if (!seed) return [false, 'seed-state.json not loaded (see G4)']
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

// ---------- G4b comparison (pre-upgrade snapshot vs now) ----------
//
// Normalisation, and nothing else (no field is stripped):
// - JSON object key order is ignored (objects are compared key by key);
// - null, [], {} and a missing key are all "unset" and compare equal. Reason: these are the
//   protobuf-JSON spellings of "unset": the v2.6.4 web writes unset fields as null / [], the
//   v2.7.1 web omits them, and v2.7.1's NetworkConfig has 14 fields v2.6.4 lacks (socket_mark,
//   peers, vpn_portal_config, managed_credentials, dns, ...). A non-empty value on either side
//   IS reported as a difference. false / 0 / "" are real values, not unset.
// - networking_method (proto enum NetworkingMethod, identical in both versions: PublicServer=0,
//   Manual=1, Standalone=2) is compared by value: v2.6.4 writes the number (1), v2.7.1 the name
//   ("Manual"); both are valid protobuf-JSON for the same value. An unknown name stays a diff.
// - TOML is compared line by line, exactly (both are produced by the same 2.6.4 core).
// Array order is significant.

const NETWORKING_METHOD: Record<string, number> = { PublicServer: 0, Manual: 1, Standalone: 2 }
function normConfig(c: unknown): unknown {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return c
  const o = c as Record<string, unknown>
  const m = o.networking_method
  return typeof m === 'string' && m in NETWORKING_METHOD ? { ...o, networking_method: NETWORKING_METHOD[m] } : o
}

const isUnset = (v: unknown) =>
  v === null ||
  v === undefined ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

function diffJson(a: unknown, b: unknown, path = '$', out: string[] = []): string[] {
  if (isUnset(a) && isUnset(b)) return out
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} → ${b.length}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
    else a.forEach((x, i) => diffJson(x, b[i], `${path}[${i}]`, out))
    return out
  }
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (isObj(a) && isObj(b)) {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    for (const k of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()) diffJson(ao[k], bo[k], `${path}.${k}`, out)
    return out
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a) ?? '(missing)'} → ${JSON.stringify(b) ?? '(missing)'}`)
  return out
}

// Minimal line diff (LCS); returns "- old" / "+ new" lines, empty when equal.
function diffLines(a: string, b: string): string[] {
  const x = a.split('\n')
  const y = b.split('\n')
  const L = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++
      j++
    } else if (i < x.length && (j >= y.length || L[i + 1]![j]! >= L[i]![j + 1]!)) out.push(`- ${x[i++]}`)
    else out.push(`+ ${y[j++]}`)
  }
  return out
}

interface SnapshotRecord {
  machine: string
  name: string
  network: 'home' | 'lab'
  captured_at: string
  config: unknown
  toml?: string
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
  const s0 = readJsonFile<Seed>(stateFile, SEED_HINT)
  ev.push(`seed-state.json: \`${JSON.stringify(s0)}\``)
  for (const name of NAMES) must(s0[MACHINES[name]]?.home, `seed-state.json has no home instance for ${name}`)
  must(s0[MACHINES.core2]?.lab, 'seed-state.json has no lab instance for core2')
  seed = s0
  const seedNow = s0
  const { status, ms } = await poll(60_000, 'legacy instances present, home running, lab stored but not running', async () => {
    const parts: string[] = []
    let ok = true
    for (const name of NAMES) {
      const m = MACHINES[name]
      const s = seedNow[m]!
      const ids = await instIds(m)
      const all = new Set([...ids.running, ...ids.storedNotRunning])
      const missing = [s.home, ...(s.lab ? [s.lab] : [])].filter((i) => !all.has(i))
      if (missing.length) ok = false
      const home = await instRunning(m, s.home)
      if (!home.running) ok = false
      let lab = ''
      if (name === 'core2' && s.lab) {
        // lab was saved with disabled=true: it must be stored (in disabled_inst_ids) and not running.
        const labStoredNotRunning = ids.storedNotRunning.includes(s.lab) && !ids.running.includes(s.lab)
        if (!labStoredNotRunning) ok = false
        lab = ` lab ${s.lab} in disabled_inst_ids=${ids.storedNotRunning.includes(s.lab)} in running_inst_ids=${ids.running.includes(s.lab)}`
      }
      parts.push(
        `${name}: running_inst_ids=[${ids.running.join(',')}] disabled_inst_ids=[${ids.storedNotRunning.join(',')}]` +
          `${missing.length ? ` MISSING=[${missing.join(',')}]` : ''} home running=${home.running}${home.error ? ` error=${home.error}` : ''}${lab}`,
      )
    }
    return [ok, parts.join('; ')]
  })
  ev.push(`${(ms / 1000).toFixed(1)}s 后满足`)
  for (const p of status.split('; ')) ev.push(p)
  ev.push(
    '字段含义：`GET /machines/{id}/networks` 的 `running_inst_ids` 是 core 上正在运行的实例；`disabled_inst_ids` 是 web 已保存、但 core 上没有在运行的实例（上游按“已保存的配置减去正在运行的”计算），不等于“已停用”。lab 保存时设了 disabled=true，所以应在 `disabled_inst_ids` 而不在 `running_inst_ids`',
  )
})

await check('G4b', '重启 core 后由 v2.7.1 重新下发旧实例，配置与升级前一致', ['G1', 'G4'], async (ev) => {
  const s = seed!
  const snap = readJsonFile<{ instances?: Record<string, SnapshotRecord> }>(snapshotFile, SEED_HINT)
  const homes = NAMES.map((name) => ({ name, machine: MACHINES[name], inst: s[MACHINES[name]]!.home }))
  const lab = { name: 'core2' as const, machine: MACHINES.core2, inst: s[MACHINES.core2]!.lab! }
  for (const h of homes) {
    const r = snap.instances?.[h.inst]
    must(r && typeof r.toml === 'string' && r.config, `seed-snapshot.json has no TOML/config for ${h.name} home ${h.inst}: ${SEED_HINT}`)
  }
  must(snap.instances?.[lab.inst]?.config, `seed-snapshot.json has no config for core2 lab ${lab.inst}: ${SEED_HINT}`)
  ev.push(
    `升级前快照（seed-legacy.ts 在 web v2.6.4 上抓取）：${[...homes, lab].map((x) => `${x.name} ${snap.instances![x.inst]!.network} ${snap.instances![x.inst]!.captured_at}`).join('; ')}`,
  )

  // Core session ids before the restart: answers must come from the NEW core processes,
  // not from a stale session the web has not dropped yet.
  const sessions = async () => {
    const r = await call<{ machines: MachineItem[] }>('GET', '/machines')
    const out: Record<string, string> = {}
    for (const name of NAMES) {
      const m = r.machines.find((x) => idStr(x.info?.machine_id) === MACHINES[name])
      out[name] = m?.online ? idStr(m.info?.inst_id) : ''
    }
    return out
  }
  const before = await sessions()
  for (const name of NAMES) must(before[name], `${name} has no online session before the restart`)

  const t0 = Date.now()
  execFileSync('docker', ['compose', '-f', composeFile, 'restart', 'core1', 'core2', 'core3'], { stdio: 'pipe' })
  ev.push(`1. \`docker compose -f ${relative(process.cwd(), composeFile)} restart core1 core2 core3\` 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`)

  let labSeenRunning: string | undefined
  const back = await poll(90_000, 'new core sessions, home instances re-delivered and running, core1 routes to core2/core3, lab not running', async () => {
    const parts: string[] = []
    let ok = true
    const now = await sessions()
    const fresh = NAMES.filter((n) => now[n] && now[n] !== before[n])
    if (fresh.length !== NAMES.length) ok = false
    parts.push(`new core sessions=[${fresh.join(',')}]`)
    for (const h of homes) {
      const st = await instRunning(h.machine, h.inst)
      if (!st.running) ok = false
      let extra = ''
      if (h.name === 'core1') {
        const hasBoth = st.routeHosts.includes('core2') && st.routeHosts.includes('core3')
        if (!hasBoth) ok = false
        extra = ` routes=[${st.routeHosts.join(',')}]`
      }
      parts.push(`${h.name} home running=${st.running}${st.error ? ` error=${st.error}` : ''}${extra}`)
    }
    const ids = await instIds(lab.machine)
    const labRunning = ids.running.includes(lab.inst)
    const labStored = ids.storedNotRunning.includes(lab.inst)
    if (labRunning) labSeenRunning ??= `${((Date.now() - t0) / 1000).toFixed(1)}s`
    if (labRunning || !labStored) ok = false
    parts.push(`core2 lab in running_inst_ids=${labRunning} in disabled_inst_ids=${labStored}`)
    return [ok, parts.join('; ')]
  })
  ev.push(`2. 重启后 ${(back.ms / 1000).toFixed(1)}s 满足（时限 90s）：${back.status}`)
  ev.push(`三台 core 的心跳会话 id（/machines 的 info.inst_id）都换了新的，说明回答来自重启后的新进程：${NAMES.map((n) => `${n} ${before[n]!.slice(0, 8)}…`).join(', ')} 都已变化`)
  must(!labSeenRunning, `core2 lab ${lab.inst} was seen running at ${labSeenRunning} after the restart`)
  ev.push('3. 轮询期间 core2 的 lab 一次也没有出现在 running_inst_ids 里')

  const diffs: string[] = []
  for (const h of homes) {
    const pre = snap.instances![h.inst]!
    const toml = await nodeToml(h.machine, h.inst)
    must(typeof toml === 'string', `show_node_info for ${h.name} home returned no config`)
    const cfg = await call<unknown>('GET', `/machines/${h.machine}/networks/config/${h.inst}`)
    const dt = diffLines(pre.toml!, toml)
    const dc = diffJson(normConfig(pre.config), normConfig(cfg))
    ev.push(`4. ${h.name} home：show_node_info TOML ${dt.length ? `有 ${dt.length} 行差异` : '与升级前逐行相同'}（${toml.split('\n').length} 行）；GET networks/config ${dc.length ? `有 ${dc.length} 处差异` : '与升级前一致'}`)
    if (dt.length) diffs.push(`${h.name} home TOML diff (- 升级前 2.6.4 / + 现在 v2.7.1):\n${dt.join('\n')}`)
    if (dc.length) diffs.push(`${h.name} home config diff (升级前 → 现在):\n${dc.join('\n')}`)
  }
  {
    const pre = snap.instances![lab.inst]!
    const cfg = await call<unknown>('GET', `/machines/${lab.machine}/networks/config/${lab.inst}`)
    const dc = diffJson(normConfig(pre.config), normConfig(cfg))
    ev.push(`4. core2 lab（未运行，接口直接读数据库里的配置）：GET networks/config ${dc.length ? `有 ${dc.length} 处差异` : '与升级前一致'}`)
    if (dc.length) diffs.push(`core2 lab config diff (升级前 → 现在):\n${dc.join('\n')}`)
  }
  ev.push(
    '比较规则：不剔除任何字段；JSON 忽略键顺序；null / [] / {} / 缺失都算“未设置”（v2.6.4 把未设置字段写成 null 或 []，v2.7.1 直接省略，且 v2.7.1 的 NetworkConfig 多 14 个字段）；`networking_method` 按枚举值比较（v2.6.4 写数字 1，v2.7.1 写名字 "Manual"，proto 里 Manual = 1，两版相同）；TOML 逐行精确比较；数组顺序有意义',
  )
  if (diffs.length) {
    for (const d of diffs) ev.push(`差异：\n\n\`\`\`\n${d}\n\`\`\``)
    throw new CheckFail(`${diffs.length} snapshot comparison(s) differ (see evidence)`)
  }
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
      virtual_cidr: GATE_CIDR,
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

  const routes = await poll(120_000, `core2 route to core3 with an IPv4 in ${GATE_CIDR}`, async () => {
    const r = await call<{ routes?: Route[] }>('POST', `/machines/${MACHINES.core2}/proxy-rpc`, {
      service_name: 'api.instance.PeerManageRpcService',
      method_name: 'list_route',
      payload: { instance: { id: strToUuid(networkId!) } },
    })
    const rs = r.routes ?? []
    const hosts = rs.map((x) => `${x.hostname}(${routeIpv4(x) ?? 'no ipv4'}/${x.ipv4_addr?.network_length ?? '?'}, ${x.version ?? '?'})`)
    const ok = rs.some((x) => {
      const ip = routeIpv4(x)
      return x.hostname === 'core3' && ip !== undefined && ipv4InCidr(ip, GATE_CIDR)
    })
    return [ok, `routes=[${hosts.join(', ')}]`]
  })
  ev.push(
    `5. core2 proxy-rpc list_route（${(routes.ms / 1000).toFixed(1)}s 后满足 hostname=core3 且 IPv4 在 ${GATE_CIDR} 内）：${routes.status}`,
  )
})

await check('G6', '清理和回归', ['G1'], async (ev) => {
  must(networkId, 'G5 did not create a network, nothing to delete')
  await call('DELETE', `/networks/${networkId}`)
  ev.push(`DELETE /networks/${networkId} → ${last?.status}${last?.body ? ` ${last.body}` : '（空响应体）'}`)
  // 90s: removal is heartbeat-driven and took 32–34s in earlier runs.
  const gone = await poll(90_000, 'gate instance removed from core2 and core3', async () => {
    const parts: string[] = []
    let ok = true
    for (const name of ['core2', 'core3'] as const) {
      const ids = await instIds(MACHINES[name])
      const present = ids.running.includes(networkId!) || ids.storedNotRunning.includes(networkId!)
      if (present) ok = false
      parts.push(
        `${name} has ${networkId}=${present} (running_inst_ids=[${ids.running.join(',')}] disabled_inst_ids=[${ids.storedNotRunning.join(',')}])`,
      )
    }
    return [ok, parts.join('; ')]
  })
  ev.push(`实例消失（${(gone.ms / 1000).toFixed(1)}s 后满足，时限 90s）：${gone.status}`)
  must(seed, 'seed-state.json not loaded (G4 failed), cannot check the home instances')
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

// Keep hand-written notes (everything from MANUAL_MARKER on) from an earlier report of the same day.
let manual = `${MANUAL_MARKER}\n`
if (existsSync(reportFile)) {
  const old = readFileSync(reportFile, 'utf8')
  const i = old.indexOf(MANUAL_MARKER)
  if (i >= 0) manual = old.slice(i)
}
if (lines[lines.length - 1] !== '') lines.push('')
mkdirSync(dirname(reportFile), { recursive: true })
writeFileSync(reportFile, `${lines.join('\n')}\n${manual}`)
console.log(lines[0])
console.log(`report: ${reportFile}`)
process.exit(pass ? 0 : 1)
