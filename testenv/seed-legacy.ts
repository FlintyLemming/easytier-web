// Seeds an easytier-web 2.6.4 test env with the legacy data set (idempotent).
// Run: node testenv/seed-legacy.ts   (env started with ET_WEB_TAG=v2.6.4)
//
// Also records a pre-upgrade snapshot in testenv/data/seed-snapshot.json, which
// gate-check G4b compares against after the upgrade: per seeded instance, the
// config the web API returns (GET /machines/{id}/networks/config/{inst}) and, for
// running instances, the TOML the core runs (show_node_info `config`). Records
// already in the snapshot are kept, so the baseline stays the first 2.6.4 capture.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, EtApiError, MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data')
const stateFile = join(dataDir, 'seed-state.json')
const snapshotFile = join(dataDir, 'seed-snapshot.json')

type Cfg = Record<string, unknown>
type Names = 'core1' | 'core2' | 'core3'

const homeCommon = {
  network_name: 'home',
  network_secret: 'home-secret',
  dhcp: false,
  network_length: 24,
  listener_urls: ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'],
}

const homeConfigs: Record<Names, Cfg> = {
  core1: {
    virtual_ipv4: '10.144.144.1',
    networking_method: 1,
    peer_urls: ['tcp://core2:11010'],
  },
  core2: {
    virtual_ipv4: '10.144.144.2',
    networking_method: 0,
    public_server_url: 'tcp://core1:11010',
  },
  core3: {
    virtual_ipv4: '10.144.144.3',
    networking_method: 0,
    public_server_url: 'tcp://core1:11010',
    proxy_cidrs: ['192.168.77.0/24'],
    mtu: 1300,
    enable_socks5: true,
    socks5_port: 1080,
  },
}

const labConfig: Cfg = {
  network_name: 'lab',
  network_secret: 'lab-secret',
  dhcp: true,
  networking_method: 2,
  listener_urls: ['tcp://0.0.0.0:11020'],
}

type Id = UuidParts | string
const idStr = (i: Id) => (typeof i === 'string' ? i : uuidToStr(i))
// running_inst_ids: running on the core now; disabled_inst_ids: stored by the web but
// not running on the core (a disabled config, or an enabled one not delivered yet).
interface InstList {
  running_inst_ids: Id[]
  disabled_inst_ids: Id[]
}
interface Metas {
  metas: Record<string, { inst_id: Id; network_name: string }>
}

const api = new EtApi(base)
await waitForApi(api)
await api.login('admin', 'admin')

await waitFor(
  async () => {
    const r = await api.get<{ machines: { info?: { machine_id: UuidParts } }[] }>('/machines')
    const ids = new Set(r.machines.map((m) => (m.info ? uuidToStr(m.info.machine_id) : '')))
    return Object.values(MACHINES).every((id) => ids.has(id)) ? true : undefined
  },
  60_000,
  'core1..3 to register',
)

// network_name -> instance id, per machine
async function existing(machine: string): Promise<Record<string, string>> {
  const list = await api.get<InstList>(`/machines/${machine}/networks`)
  const ids = [...(list.running_inst_ids ?? []), ...(list.disabled_inst_ids ?? [])].map(idStr)
  if (!ids.length) return {}
  const m = await api.post<Metas>(`/machines/${machine}/networks/metas`, { instance_ids: ids })
  const out: Record<string, string> = {}
  for (const meta of Object.values(m.metas ?? {})) {
    out[meta.network_name] = idStr(meta.inst_id)
  }
  return out
}

async function create(machine: string, cfg: Cfg): Promise<string> {
  const instance_id = randomUUID()
  await api.post(`/machines/${machine}/networks`, { config: { instance_id, ...cfg }, save: true })
  return instance_id
}

const state: Record<string, { home: string; lab?: string }> = {}
let seeded = 0
let skipped = 0

for (const name of ['core1', 'core2', 'core3'] as const) {
  const machine = MACHINES[name]
  const have = await existing(machine)
  let home = have.home
  if (home) {
    skipped++
  } else {
    home = await create(machine, { ...homeCommon, ...homeConfigs[name] })
    seeded++
  }
  state[machine] = { home }

  if (name === 'core2') {
    let lab = have.lab
    if (lab) {
      skipped++
    } else {
      lab = await create(machine, labConfig)
      await api.put(`/machines/${machine}/networks/${lab}`, { disabled: true })
      seeded++
    }
    state[machine]!.lab = lab
  }
}

console.log(seeded ? `seeded ${seeded} instances` : `skipped ${skipped} existing`)
if (seeded && skipped) console.log(`skipped ${skipped} existing`)

interface RunInfo {
  info: { map: Record<string, { running: boolean; routes?: { hostname?: string }[] }> }
}
const running = await waitFor(
  async () => {
    let n = 0
    for (const name of ['core1', 'core2', 'core3'] as const) {
      const machine = MACHINES[name]
      const inst = state[machine]!.home
      const r = await api.get<RunInfo>(`/machines/${machine}/networks/info/${inst}`)
      const i = r.info?.map?.[inst]
      if (!i?.running) return undefined
      if (name === 'core1') {
        const hosts = new Set((i.routes ?? []).map((x) => x.hostname))
        if (!hosts.has('core2') || !hosts.has('core3')) return undefined
      }
      n++
    }
    return n
  },
  90_000,
  'home instances running with core1 routes to core2/core3',
)
console.log(`${running} running`)

mkdirSync(dirname(stateFile), { recursive: true })
writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n')

// ---------- pre-upgrade snapshot for gate-check G4b ----------

interface SnapshotRecord {
  machine: string
  name: Names
  network: 'home' | 'lab'
  captured_at: string
  config: unknown // GET /machines/{id}/networks/config/{inst}
  toml?: string // show_node_info node_info.config; only for running (home) instances
}
interface Snapshot {
  instances: Record<string, SnapshotRecord>
}

// Only a legacy (2.6.4) web may provide the baseline; it has no /console-info (404).
async function webIsLegacy(): Promise<boolean> {
  try {
    await api.get('/console-info')
    return false
  } catch (e) {
    if (e instanceof EtApiError && e.status === 404) return true
    throw e
  }
}

const snapshot: Snapshot = existsSync(snapshotFile)
  ? (JSON.parse(readFileSync(snapshotFile, 'utf8')) as Snapshot)
  : { instances: {} }
snapshot.instances ??= {}
const wanted: { inst: string; machine: string; name: Names; network: 'home' | 'lab' }[] = []
for (const name of ['core1', 'core2', 'core3'] as const) {
  const machine = MACHINES[name]
  wanted.push({ inst: state[machine]!.home, machine, name, network: 'home' })
  if (state[machine]!.lab) wanted.push({ inst: state[machine]!.lab!, machine, name, network: 'lab' })
}
const missing = wanted.filter((w) => !snapshot.instances[w.inst])
if (!missing.length) {
  console.log(`snapshot: kept ${wanted.length} existing`)
} else if (!(await webIsLegacy())) {
  console.log(`snapshot: NOT captured for ${missing.length} instances (web is not 2.6.4; the baseline must come from 2.6.4)`)
} else {
  for (const w of missing) {
    const config = await api.get<unknown>(`/machines/${w.machine}/networks/config/${w.inst}`)
    const rec: SnapshotRecord = { machine: w.machine, name: w.name, network: w.network, captured_at: new Date().toISOString(), config }
    if (w.network === 'home') {
      const r = await api.post<{ node_info?: { config?: string } }>(`/machines/${w.machine}/proxy-rpc`, {
        service_name: 'api.instance.PeerManageRpcService',
        method_name: 'show_node_info',
        payload: { instance: { id: strToUuid(w.inst) } },
      })
      if (typeof r?.node_info?.config !== 'string') throw new Error(`show_node_info for ${w.name} ${w.inst} returned no config`)
      rec.toml = r.node_info.config
    }
    snapshot.instances[w.inst] = rec
  }
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`snapshot: captured ${missing.length}, kept ${wanted.length - missing.length}`)
}
