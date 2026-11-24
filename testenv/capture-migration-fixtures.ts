// Capture what the migration wizard reads and does, against the migration rehearsal env
// (testenv/README.md "迁移演练环境": data-migrate seeded on 2.6.4, upgraded to web v2.7.1,
// core1..4 running with `--profile migrate`):
//   ET_DATA_DIR=./data-migrate node testenv/capture-migration-fixtures.ts
//
// 1. the legacy inventory: /machines, each device's instance list, metas and running configs;
// 2. the stored configs (each running office instance is disabled, read, and enabled again);
// 3. one real migration of core2 into a temporary central network "office" and its rollback,
//    with the TOMLs before and after and their parse-config results (flow-core2.json);
// 4. the answer for listing the instances of an offline device (core4 stopped for a moment).
// Everything is restored in `finally`: the network is deleted, core2's legacy instance is enabled
// again, core4 is started again.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EtApi, EtApiError, MIGRATE_MACHINES, strToUuid, uuidToStr, waitFor, waitForApi } from './lib/api.ts'
import type { UuidParts } from './lib/api.ts'
import { saveAll } from './lib/save-fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tests', 'fixtures', 'v2.7.1', 'migrate')
const composeFile = join(here, 'docker-compose.yml')
const base = process.env.ET_API ?? 'http://localhost:11211'
const api = new EtApi(base, { timeoutMs: 30_000 })
const log = (m: string) => console.log(`[capture-migration] ${m}`)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Name = keyof typeof MIGRATE_MACHINES
const NAMES = Object.keys(MIGRATE_MACHINES) as Name[]

const compose = (...args: string[]) =>
  execFileSync('docker', ['compose', '-f', composeFile, '--profile', 'migrate', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ET_DATA_DIR: process.env.ET_DATA_DIR ?? './data-migrate' },
  })

const idStr = (i: UuidParts | string) => (typeof i === 'string' ? i : uuidToStr(i))

// Fields the central compiler owns, the member fields, and the legacy VPN portal fields (which a
// member override must never carry): everything else of the stored config goes into the override.
const CENTRAL = new Set([
  'instance_id', 'dhcp', 'dhcp_ipv4_cidr', 'dhcpv6', 'dhcp_ipv6_cidr', 'virtual_ipv4', 'network_length',
  'hostname', 'network_name', 'network_secret', 'networking_method', 'public_server_url', 'peer_urls',
  'peers', 'secure_mode', 'managed_credentials', 'acl', 'credential_file',
])
const MEMBER = new Set(['proxy_cidrs'])
const LEGACY_VPN = new Set([
  'enable_vpn_portal', 'vpn_portal_listen_port', 'vpn_portal_client_network_addr', 'vpn_portal_client_network_len',
])

async function instances(machine: string): Promise<{ running: string[]; disabled: string[] }> {
  const r = await api.get<Any>(`/machines/${machine}/networks`)
  return { running: (r.running_inst_ids ?? []).map(idStr), disabled: (r.disabled_inst_ids ?? []).map(idStr) }
}

async function running(machine: string, inst: string): Promise<boolean> {
  const r = await api.get<Any>(`/machines/${machine}/networks/info/${inst}`)
  return r?.info?.map?.[inst]?.running === true
}

async function nodeToml(machine: string, inst: string): Promise<string> {
  const r = await api.post<Any>(`/machines/${machine}/proxy-rpc`, {
    service_name: 'api.instance.PeerManageRpcService',
    method_name: 'show_node_info',
    payload: { instance: { id: strToUuid(inst) } },
  })
  const toml = r?.node_info?.config
  if (typeof toml !== 'string') throw new Error(`show_node_info ${machine} ${inst}: no config`)
  return toml
}

/**
 * A 2.6.4 core reports its config source as a trailing `[source] source = "webhook"` table, which
 * web v2.7.1's parse-config rejects (it knows `user` / `web`); the table carries no network config.
 */
function stripSourceTable(toml: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of toml.split('\n')) {
    const header = /^\s*\[/.test(line)
    if (header) skipping = /^\s*\[source\]\s*$/.test(line)
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

async function parse(toml: string): Promise<Any> {
  const r = await api.post<Any>('/parse-config', { toml_config: stripSourceTable(toml) })
  if (r?.error) throw new Error(`parse-config: ${r.error}`)
  return r.config
}

async function disableAndWait(machine: string, inst: string) {
  await api.put(`/machines/${machine}/networks/${inst}`, { disabled: true })
  await waitFor(async () => ((await instances(machine)).running.includes(inst) ? undefined : true), 60_000, `${inst} stopped`)
}

async function enableAndWait(machine: string, inst: string) {
  await api.put(`/machines/${machine}/networks/${inst}`, { disabled: false })
  await waitFor(async () => ((await running(machine, inst)) ? true : undefined), 90_000, `${inst} running again`)
}

await waitForApi(api)
await api.login('admin', 'admin')
await waitFor(
  async () => {
    const r = await api.get<Any>('/machines')
    const online = new Set(r.machines.filter((m: Any) => m.online).map((m: Any) => idStr(m.info.machine_id)))
    return NAMES.every((n) => online.has(MIGRATE_MACHINES[n])) ? true : undefined
  },
  90_000,
  'core1..4 online',
)
const nets = await api.get<Any>('/networks')
if ((nets.networks ?? []).length) throw new Error('expected no central network in the migration env')

const files: [string, unknown][] = []
const index: Any = { machines: { ...MIGRATE_MACHINES }, instances: {} }
// name -> network -> { id, running }
const found: Record<string, Record<string, { id: string; running: boolean }>> = {}

// ---------- 1. inventory ----------
files.push(['machines.json', await api.get('/machines')])
for (const name of NAMES) {
  const machine = MIGRATE_MACHINES[name]
  const listRaw = await api.get<Any>(`/machines/${machine}/networks`)
  files.push([`instances-${name}.json`, listRaw])
  const list = await instances(machine)
  const ids = [...list.running, ...list.disabled]
  const metas = await api.post<Any>(`/machines/${machine}/networks/metas`, { instance_ids: ids })
  files.push([`metas-${name}.json`, metas])
  found[name] = {}
  index.instances[name] = {}
  for (const meta of Object.values<Any>(metas.metas ?? {})) {
    const id = idStr(meta.inst_id)
    found[name]![meta.network_name] = { id, running: list.running.includes(id) }
    index.instances[name][meta.network_name] = id
  }
  for (const [net, inst] of Object.entries(found[name]!)) {
    if (inst.running) files.push([`config-${name}-${net}.json`, await api.get(`/machines/${machine}/networks/config/${inst.id}`)])
  }
}
files.push(['index.json', index])
log(`inventory: ${JSON.stringify(index.instances)}`)

const core2Office = found.core2?.office?.id
if (!core2Office) throw new Error('core2 has no office instance; seed the env first')
const M2 = MIGRATE_MACHINES.core2

let networkId: string | null = null
let core2Disabled = false
let core4Stopped = false
const flow: Any = { timings: {} }
try {
  // ---------- 2. stored configs ----------
  const stored: Record<string, Any> = {}
  for (const name of NAMES) {
    const machine = MIGRATE_MACHINES[name]
    for (const [net, inst] of Object.entries(found[name]!)) {
      if (inst.running && name !== 'core2') {
        await disableAndWait(machine, inst.id)
        try {
          stored[`${name}-${net}`] = await api.get(`/machines/${machine}/networks/config/${inst.id}`)
        } finally {
          await enableAndWait(machine, inst.id)
        }
      } else if (!inst.running) {
        stored[`${name}-${net}`] = await api.get(`/machines/${machine}/networks/config/${inst.id}`)
      }
    }
  }

  // ---------- 3. core2: migrate, then roll back ----------
  flow.legacyToml = await nodeToml(M2, core2Office)
  await disableAndWait(M2, core2Office)
  core2Disabled = true
  const s2 = await api.get<Any>(`/machines/${M2}/networks/config/${core2Office}`)
  stored['core2-office'] = s2
  for (const [k, v] of Object.entries(stored)) files.push([`stored-${k}.json`, v])

  const created = await api.post<Any>('/networks', {
    settings: {
      display_name: 'office',
      network_name: 'office',
      networking_method: 'Manual',
      public_server_url: null,
      peer_urls: ['tcp://core1:11010'],
      virtual_cidr: '10.150.0.0/24',
      secure_mode: false,
    },
    network_secret: 'office-secret',
  })
  networkId = created.network_id as string
  log(`network ${networkId}`)
  const t0 = Date.now()
  await api.post(`/networks/${networkId}/members`, { device_ids: [M2], temporary: false })
  await api.patch(`/networks/${networkId}/members/${M2}`, { virtual_ipv4: '10.150.0.2', hostname_override: 'core2-office' })
  const override: Any = {}
  for (const [k, v] of Object.entries(s2)) {
    if (CENTRAL.has(k) || MEMBER.has(k) || LEGACY_VPN.has(k) || k === 'hostname') continue
    override[k] = v
  }
  override.proxy_cidrs = s2.proxy_cidrs
  await api.put(`/networks/${networkId}/members/${M2}/config`, { config: override })
  flow.overrideSent = override
  const member = await waitFor(
    async () => {
      const r = await api.get<Any>(`/networks/${networkId}/members`)
      const m = (r.members ?? []).find((x: Any) => x.device_id === M2)
      return m?.running === true ? m : undefined
    },
    120_000,
    'core2 member running',
  )
  flow.timings.runningAfterMs = Date.now() - t0
  flow.memberAfterSettings = member
  flow.centralToml = await nodeToml(M2, networkId)
  const gen = await api.post<Any>('/generate-config', {
    config: Object.fromEntries(Object.entries(s2).filter(([k]) => !LEGACY_VPN.has(k))),
  })
  if (gen?.error) throw new Error(`generate-config: ${gen.error}`)
  flow.generatedFromStored = gen.toml_config
  flow.parsedLegacy = await parse(flow.legacyToml)
  flow.parsedCentral = await parse(flow.centralToml)
  flow.parsedGenerated = await parse(flow.generatedFromStored)

  // A legacy instance with the central network's name cannot be (re)created while a member.
  try {
    await api.post(`/machines/${M2}/networks`, { config: { ...s2 }, save: true })
    flow.recreate409 = { status: 200, message: 'accepted' }
  } catch (e) {
    if (!(e instanceof EtApiError)) throw e
    let message = e.body
    try {
      message = JSON.parse(e.body).message ?? e.body
    } catch { /* plain text */ }
    flow.recreate409 = { status: e.status, message }
  }

  // Roll back: remove the member, wait for the central instance to leave core2, enable legacy.
  const t1 = Date.now()
  await api.del(`/networks/${networkId}/members/${M2}`)
  await waitFor(
    async () => ((await instances(M2)).running.includes(networkId!) ? undefined : true),
    90_000,
    'central instance gone from core2',
  )
  flow.timings.goneAfterRemoveMs = Date.now() - t1
  const t2 = Date.now()
  await enableAndWait(M2, core2Office)
  core2Disabled = false
  flow.timings.reenabledRunningAfterMs = Date.now() - t2
  await api.del(`/networks/${networkId}`)
  networkId = null
  files.push(['flow-core2.json', flow])

  // ---------- 4. offline device ----------
  compose('stop', 'core4')
  core4Stopped = true
  await waitFor(
    async () => {
      const r = await api.get<Any>('/machines')
      const m = r.machines.find((x: Any) => x.info && idStr(x.info.machine_id) === MIGRATE_MACHINES.core4)
      return m && !m.online ? true : undefined
    },
    90_000,
    'core4 offline',
  )
  try {
    await api.get(`/machines/${MIGRATE_MACHINES.core4}/networks`)
    files.push(['offline-instances-error.json', { status: 200, body: 'unexpected success' }])
  } catch (e) {
    if (!(e instanceof EtApiError)) throw e
    let body: unknown = e.body
    try {
      body = JSON.parse(e.body)
    } catch { /* plain text */ }
    files.push(['offline-instances-error.json', { status: e.status, body }])
  }
} finally {
  if (networkId) {
    try {
      await api.del(`/networks/${networkId}/members/${M2}`)
    } catch { /* not a member */ }
    await waitFor(async () => ((await instances(M2)).running.includes(networkId!) ? undefined : true), 90_000, 'cleanup: central gone')
    await api.del(`/networks/${networkId}`)
  }
  if (core2Disabled) await enableAndWait(M2, core2Office)
  if (core4Stopped) {
    compose('start', 'core4')
    await waitFor(
      async () => {
        const r = await api.get<Any>('/machines')
        const m = r.machines.find((x: Any) => x.info && idStr(x.info.machine_id) === MIGRATE_MACHINES.core4)
        return m?.online ? true : undefined
      },
      90_000,
      'core4 online again',
    )
  }
}

saveAll(outDir, files, log)
log(`timings ${JSON.stringify(flow.timings)}; recreate ${JSON.stringify(flow.recreate409)}`)
