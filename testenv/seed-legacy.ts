// Seeds an easytier-web 2.6.4 test env with the legacy data set (idempotent).
// Run: node testenv/seed-legacy.ts   (env started with ET_WEB_TAG=v2.6.4)
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, MACHINES, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'

const base = process.env.ET_API ?? 'http://localhost:11211'
const stateFile = join(dirname(fileURLToPath(import.meta.url)), 'data', 'seed-state.json')

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
