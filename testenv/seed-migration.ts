// Seeds the migration rehearsal data set on an easytier-web 2.6.4 test env (idempotent).
// Run: ET_DATA_DIR=./data-migrate node testenv/seed-migration.ts
//      (env started with ET_DATA_DIR=./data-migrate ET_WEB_TAG=v2.6.4 ... --profile migrate up -d)
//
// The data set mirrors what production holds (spec §1): one shared network "office" whose
// instances differ per device (Manual vs PublicServer, a custom hostname, subnet proxy, port
// forward, MTU/socks5, an ACL on one device, a legacy VPN portal, one disabled instance) and a
// second network "lab-old" that is disabled, DHCP and has an ACL.
//
// Also records a pre-upgrade snapshot in <ET_DATA_DIR>/seed-snapshot.json: per instance, the config
// the web API returns and, for running instances, the TOML the core runs. Records already in the
// snapshot are kept (the baseline is the first 2.6.4 capture); only a 2.6.4 web may write it.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, EtApiError, MIGRATE_MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'

const here = dirname(fileURLToPath(import.meta.url))
const rawDir = process.env.ET_DATA_DIR ?? './data-migrate'
const dataDir = isAbsolute(rawDir) ? rawDir : join(here, rawDir.replace(/^\.\//, ''))
const base = process.env.ET_API ?? 'http://localhost:11211'
const stateFile = join(dataDir, 'seed-state.json')
const snapshotFile = join(dataDir, 'seed-snapshot.json')

type Cfg = Record<string, unknown>
type Name = keyof typeof MIGRATE_MACHINES

const officeCommon: Cfg = {
  network_name: 'office',
  network_secret: 'office-secret',
  dhcp: false,
  network_length: 24,
  listener_urls: ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'],
}

const aclDeny = (port: string, name: string): Cfg => ({
  acl_v1: {
    chains: [
      {
        name: 'inbound',
        chain_type: 1, // Inbound
        description: `deny ${port}`,
        enabled: true,
        rules: [
          {
            name,
            description: '',
            priority: 100,
            enabled: true,
            protocol: 1, // TCP
            ports: [port],
            source_ips: [],
            destination_ips: [],
            source_ports: [],
            action: 2, // Drop
            rate_limit: 0,
            burst_limit: 0,
            stateful: false,
          },
        ],
        default_action: 1, // Allow
      },
    ],
  },
})

interface Seed {
  machine: Name
  network: string
  disabled: boolean
  config: Cfg
}

const SEEDS: Seed[] = [
  {
    machine: 'core1',
    network: 'office',
    disabled: false,
    config: {
      ...officeCommon,
      virtual_ipv4: '10.150.0.1',
      networking_method: 1,
      peer_urls: ['tcp://core2:11010'],
      enable_vpn_portal: true,
      vpn_portal_listen_port: 11013,
      vpn_portal_client_network_addr: '10.14.14.0',
      vpn_portal_client_network_len: 24,
    },
  },
  {
    machine: 'core1',
    network: 'lab-old',
    disabled: true,
    config: {
      network_name: 'lab-old',
      network_secret: 'lab-old-secret',
      dhcp: true,
      networking_method: 2,
      listener_urls: ['tcp://0.0.0.0:11030'],
      acl: aclDeny('22', 'deny-ssh'),
    },
  },
  {
    machine: 'core2',
    network: 'office',
    disabled: false,
    config: {
      ...officeCommon,
      virtual_ipv4: '10.150.0.2',
      networking_method: 0,
      public_server_url: 'tcp://core1:11010',
      hostname: 'core2-office',
      proxy_cidrs: ['192.168.88.0/24'],
      port_forwards: [{ bind_ip: '0.0.0.0', bind_port: 18080, dst_ip: '10.150.0.1', dst_port: 80, proto: 'tcp' }],
    },
  },
  {
    machine: 'core3',
    network: 'office',
    disabled: false,
    config: {
      ...officeCommon,
      virtual_ipv4: '10.150.0.3',
      networking_method: 0,
      public_server_url: 'tcp://core1:11010',
      mtu: 1300,
      enable_socks5: true,
      socks5_port: 1080,
      acl: aclDeny('3389', 'deny-rdp'),
    },
  },
  {
    machine: 'core4',
    network: 'office',
    disabled: true,
    config: {
      ...officeCommon,
      virtual_ipv4: '10.150.0.4',
      networking_method: 0,
      public_server_url: 'tcp://core1:11010',
    },
  },
]

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

const machineIds = Object.values(MIGRATE_MACHINES)
await waitFor(
  async () => {
    const r = await api.get<{ machines: { info?: { machine_id: UuidParts } }[] }>('/machines')
    const ids = new Set(r.machines.map((m) => (m.info ? uuidToStr(m.info.machine_id) : '')))
    return machineIds.every((id) => ids.has(id)) ? true : undefined
  },
  90_000,
  'core1..4 to register (start with --profile migrate)',
)

// network_name -> instance id, per machine
async function existing(machine: string): Promise<Record<string, string>> {
  const list = await api.get<InstList>(`/machines/${machine}/networks`)
  const ids = [...(list.running_inst_ids ?? []), ...(list.disabled_inst_ids ?? [])].map(idStr)
  if (!ids.length) return {}
  const m = await api.post<Metas>(`/machines/${machine}/networks/metas`, { instance_ids: ids })
  const out: Record<string, string> = {}
  for (const meta of Object.values(m.metas ?? {})) out[meta.network_name] = idStr(meta.inst_id)
  return out
}

const state: Record<string, Record<string, string>> = {}
let seeded = 0
let skipped = 0
for (const seed of SEEDS) {
  const machine = MIGRATE_MACHINES[seed.machine]
  const have = await existing(machine)
  let id = have[seed.network]
  if (id) {
    skipped++
  } else {
    id = randomUUID()
    await api.post(`/machines/${machine}/networks`, { config: { instance_id: id, ...seed.config }, save: true })
    if (seed.disabled) await api.put(`/machines/${machine}/networks/${id}`, { disabled: true })
    seeded++
  }
  ;(state[machine] ??= {})[seed.network] = id
}
console.log(seeded ? `seeded ${seeded} instances` : `skipped ${skipped} existing`)
if (seeded && skipped) console.log(`skipped ${skipped} existing`)

interface RunInfo {
  info: { map: Record<string, { running: boolean }> }
}
const runningSeeds = SEEDS.filter((s) => !s.disabled)
const running = await waitFor(
  async () => {
    for (const s of runningSeeds) {
      const machine = MIGRATE_MACHINES[s.machine]
      const inst = state[machine]![s.network]!
      const r = await api.get<RunInfo>(`/machines/${machine}/networks/info/${inst}`)
      if (!r.info?.map?.[inst]?.running) return undefined
    }
    return runningSeeds.length
  },
  90_000,
  'office instances running on core1..3',
)
console.log(`${running} running`)

mkdirSync(dataDir, { recursive: true })
writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n')

// ---------- pre-upgrade snapshot ----------

interface SnapshotRecord {
  machine: string
  name: Name
  network: string
  disabled: boolean
  captured_at: string
  config: unknown
  toml?: string
}
interface Snapshot {
  instances: Record<string, SnapshotRecord>
}

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
const missing = SEEDS.filter((s) => !snapshot.instances[state[MIGRATE_MACHINES[s.machine]]![s.network]!])
if (!missing.length) {
  console.log(`snapshot: kept ${SEEDS.length} existing`)
} else if (!(await webIsLegacy())) {
  console.log(`snapshot: NOT captured for ${missing.length} instances (web is not 2.6.4; the baseline must come from 2.6.4)`)
} else {
  for (const s of missing) {
    const machine = MIGRATE_MACHINES[s.machine]
    const inst = state[machine]![s.network]!
    const config = await api.get<unknown>(`/machines/${machine}/networks/config/${inst}`)
    const rec: SnapshotRecord = {
      machine,
      name: s.machine,
      network: s.network,
      disabled: s.disabled,
      captured_at: new Date().toISOString(),
      config,
    }
    if (!s.disabled) {
      const r = await api.post<{ node_info?: { config?: string } }>(`/machines/${machine}/proxy-rpc`, {
        service_name: 'api.instance.PeerManageRpcService',
        method_name: 'show_node_info',
        payload: { instance: { id: strToUuid(inst) } },
      })
      if (typeof r?.node_info?.config !== 'string') throw new Error(`show_node_info for ${s.machine} ${inst} returned no config`)
      rec.toml = r.node_info.config
    }
    snapshot.instances[inst] = rec
  }
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`snapshot: captured ${missing.length}, kept ${SEEDS.length - missing.length}`)
}
