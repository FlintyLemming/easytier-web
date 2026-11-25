// Production-copy migration rehearsal (plan 6 Task 10). Works on a LOCAL copy of the production
// et.db in <dir> (git-ignored); never contacts the production host.
//
//   node testenv/prod-rehearsal.ts generate testenv/data-prod
//       Finds the one user that owns legacy instances, sets that user's password hash in the copy
//       to testenv admin's (password "admin"), and writes <dir>/docker-compose.yml: web (image
//       easytier/easytier:${ET_WEB_TAG}, 127.0.0.1:11311) and one 2.6.4 core per device of that
//       user. The cores are only on an `internal: true` network: instances that carry the real
//       network secrets cannot reach any real peer. Prints the user name and device count only.
//   node testenv/prod-rehearsal.ts snapshot testenv/data-prod
//       Waits for the cores, records every device's running/disabled ids and the running TOMLs in
//       <dir>/snapshot.json (only on web v2.6.4, only if the file does not exist yet).
//   node testenv/prod-rehearsal.ts check testenv/data-prod [--since <epoch s>] [--timeout <s>]
//       Polls until every device runs exactly the snapshot's instances, then compares the TOMLs
//       line by line (also printing the result with the `[source]` table stripped).
//
// Output never contains secrets, IPs, machine ids or device names: devices are "设备 N".
import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, EtApiError, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'

const here = dirname(fileURLToPath(import.meta.url))
const [cmd, rawDir, ...rest] = process.argv.slice(2)
if (!cmd || !rawDir) {
  console.error('usage: node testenv/prod-rehearsal.ts generate|snapshot|check <dir> [--since <epoch s>] [--timeout <s>]')
  process.exit(2)
}
const dir = resolve(rawDir)
const API = process.env.ET_API ?? 'http://localhost:11311'
const PASSWORD = 'admin'
const opt = (name: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

interface Device { id: string; label: string; hostname: string }
interface Meta { user: string; devices: Device[] }
interface Snapshot {
  capturedAt: string
  devices: Record<string, { running: string[]; disabled: string[] }>
  toml: Record<string, string>
}

const metaFile = join(dir, 'rehearsal-meta.json')
const snapshotFile = join(dir, 'snapshot.json')
const validHostname = (h: unknown): h is string => typeof h === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(h)

/**
 * testenv admin's password hash, read from a COPY of data-central's database files. Never open a
 * database a running web container has open: even a read-only SQLite connection writes its read
 * marks into et.db-shm, and across the Docker bind mount that corrupts the container's view (disk
 * I/O errors, then a leaked transaction that fails every later write until web restarts).
 */
function adminHash(): string | undefined {
  const tmp = mkdtempSync(join(tmpdir(), 'et-admin-hash-'))
  try {
    for (const f of ['et.db', 'et.db-wal']) {
      const from = join(here, 'data-central', f)
      if (existsSync(from)) copyFileSync(from, join(tmp, f))
    }
    const db = new DatabaseSync(join(tmp, 'et.db'))
    const row = db.prepare("select password from users where username = 'admin'").get() as { password: string } | undefined
    db.close()
    return row?.password
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function generate() {
  // Never open a database a running web has open (testenv/README.md).
  const running = execSync('docker ps --filter name=et-prod-rehearsal-web --format "{{.Names}}"', { encoding: 'utf8' }).trim()
  if (running) throw new Error('the rehearsal web is running; stop it first (docker compose -p et-prod-rehearsal stop web)')
  const db = new DatabaseSync(join(dir, 'et.db'))
  const owners = db.prepare('select distinct user_id as uid from user_running_network_configs').all() as { uid: number }[]
  if (owners.length !== 1) throw new Error(`expected exactly one user with instances, found ${owners.length}`)
  const uid = owners[0]!.uid
  const user = (db.prepare('select username from users where id = ?').get(uid) as { username: string }).username
  const rows = db
    .prepare('select device_id, network_config, disabled from user_running_network_configs where user_id = ? order by device_id, disabled')
    .all(uid) as { device_id: string; network_config: string; disabled: number }[]
  const devices: Device[] = []
  let sanitized = 0
  for (const r of rows) {
    if (devices.some((d) => d.id === r.device_id)) continue
    const label = `设备 ${devices.length + 1}`
    const host = (JSON.parse(r.network_config) as { hostname?: unknown }).hostname
    const hostname = validHostname(host) ? host : `device-${devices.length + 1}`
    if (host && !validHostname(host)) sanitized++
    devices.push({ id: r.device_id, label, hostname })
  }

  const hash = adminHash()
  if (!hash) throw new Error('testenv/data-central/et.db has no admin user (start the testenv once)')
  db.prepare('update users set password = ? where id = ?').run(hash, uid)

  const cores = devices
    .map((d, i) => {
      const name = `core${String(i + 1).padStart(2, '0')}`
      return `  ${name}:
    image: easytier/easytier:v2.6.4
    hostname: ${d.hostname}
    command: ["--config-server", "udp://web:22020/${user}", "--machine-id", "${d.id}"]
    cap_add: [NET_ADMIN]
    devices: ["/dev/net/tun"]
    networks: [rehearsal]
    depends_on: [web]
`
    })
    .join('')
  const compose = `# Generated by testenv/prod-rehearsal.ts from a copy of the production database. Never commit.
# The cores are only on the internal network: no route outside this Docker host.
services:
  web:
    image: easytier/easytier:\${ET_WEB_TAG:-v2.6.4}
    entrypoint: ["easytier-web-embed"]
    command: ["--disable-registration"]
    hostname: web
    volumes: ["./:/app"]
    ports: ["127.0.0.1:11311:11211"]
    networks: [rehearsal, egress]
${cores}
networks:
  rehearsal:
    internal: true
  egress: {}
`
  db.close()
  writeFileSync(join(dir, 'docker-compose.yml'), compose)
  writeFileSync(metaFile, JSON.stringify({ user, devices } satisfies Meta, null, 2) + '\n')
  console.log(`user: ${user} (id ${uid}); password in the copy set to "${PASSWORD}"`)
  console.log(`devices: ${devices.length} (hostnames taken from the configs; ${sanitized} not usable as a container hostname, replaced)`)
}

async function login(): Promise<{ api: EtApi; meta: Meta }> {
  const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as Meta
  const api = new EtApi(API, { timeoutMs: 20_000 })
  await waitForApi(api, 90_000)
  await api.login(meta.user, PASSWORD)
  return { api, meta }
}

async function listOf(api: EtApi, id: string) {
  const l = await api.get<{ running_inst_ids?: UuidParts[]; disabled_inst_ids?: UuidParts[] }>(`/machines/${id}/networks`)
  return { running: (l.running_inst_ids ?? []).map(uuidToStr).sort(), disabled: (l.disabled_inst_ids ?? []).map(uuidToStr).sort() }
}

async function tomlOf(api: EtApi, device: string, inst: string): Promise<string> {
  const r = await api.post<{ node_info?: { config?: string } }>(`/machines/${device}/proxy-rpc`, {
    service_name: 'api.instance.PeerManageRpcService',
    method_name: 'show_node_info',
    payload: { instance: { id: strToUuid(inst) } },
  })
  return r?.node_info?.config ?? ''
}

function stripSource(toml: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) skipping = /^\s*\[source\]\s*$/.test(line)
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

async function snapshot() {
  if (existsSync(snapshotFile)) {
    console.log('snapshot.json exists; kept')
    return
  }
  const { api, meta } = await login()
  const machines = await waitFor(async () => {
    // Web 2.6.4 lists only connected sessions (no `online` field); 2.7.1 also lists offline devices.
    const r = await api.get<{ machines: { online?: boolean; info?: { machine_id: UuidParts; easytier_version?: string } }[] }>('/machines')
    const online = new Set(r.machines.filter((m) => m.online !== false && m.info).map((m) => uuidToStr(m.info!.machine_id)))
    return meta.devices.every((d) => online.has(d.id)) ? r : undefined
  }, 180_000, 'every core online')
  if (machines.machines.some((m) => m.info && !String(m.info.easytier_version ?? '').startsWith('2.6.4'))) throw new Error('a core is not 2.6.4')
  // Let the web finish starting the enabled instances.
  await new Promise((r) => setTimeout(r, 15_000))
  const snap: Snapshot = { capturedAt: new Date().toISOString(), devices: {}, toml: {} }
  let running = 0
  let disabled = 0
  for (const d of meta.devices) {
    const l = await listOf(api, d.id)
    snap.devices[d.id] = l
    running += l.running.length
    disabled += l.disabled.length
    for (const inst of l.running) snap.toml[inst] = await tomlOf(api, d.id, inst)
  }
  writeFileSync(snapshotFile, JSON.stringify(snap, null, 2) + '\n')
  console.log(`snapshot: ${meta.devices.length} devices online; ${running} running, ${disabled} disabled instances; ${Object.keys(snap.toml).length} TOMLs`)
}

async function check() {
  const snap = JSON.parse(readFileSync(snapshotFile, 'utf8')) as Snapshot
  const { api, meta } = await login()
  const since = Number(opt('--since') ?? Math.floor(Date.now() / 1000)) * 1000
  const timeoutMs = Number(opt('--timeout') ?? 90) * 1000
  let mismatched: string[] = []
  for (;;) {
    mismatched = []
    for (const d of meta.devices) {
      try {
        const l = await listOf(api, d.id)
        if (JSON.stringify(l.running) !== JSON.stringify(snap.devices[d.id]!.running)) mismatched.push(d.label)
      } catch {
        mismatched.push(`${d.label}（读取失败）`)
      }
    }
    const elapsed = Math.round((Date.now() - since) / 1000)
    if (mismatched.length === 0) {
      console.log(`running instances equal the snapshot on all ${meta.devices.length} devices at t+${elapsed}s`)
      break
    }
    if (Date.now() - since > timeoutMs) {
      console.log(`TIMEOUT at t+${elapsed}s; ${mismatched.length} devices differ: ${mismatched.join(', ')}`)
      process.exitCode = 1
      break
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  let same = 0
  let sameStripped = 0
  const differ: string[] = []
  for (const d of meta.devices) {
    for (const inst of snap.devices[d.id]!.running) {
      let toml = ''
      try {
        toml = await tomlOf(api, d.id, inst)
      } catch { /* counted as different */ }
      if (toml === snap.toml[inst]) same++
      else if (stripSource(toml) === stripSource(snap.toml[inst]!)) sameStripped++
      else differ.push(d.label)
    }
  }
  console.log(`TOML: ${same} identical, ${sameStripped} identical except the [source] table, ${differ.length} different${differ.length ? `: ${differ.join(', ')}` : ''}`)
  if (differ.length) process.exitCode = 1
}

try {
  if (cmd === 'generate') generate()
  else if (cmd === 'snapshot') await snapshot()
  else if (cmd === 'check') await check()
  else throw new Error(`unknown command ${cmd}`)
} catch (e) {
  console.error(e instanceof EtApiError || e instanceof Error ? e.message : e)
  process.exitCode = 1
}
