import type { Request } from '@playwright/test'
import { migrateFixture, status, type Overrides } from './mockApi'

/** The migration rehearsal env as fixtures: core1..4, legacy instances, no central network yet. */
export const MIG = migrateFixture<{ machines: Record<string, string>; instances: Record<string, Record<string, string>> }>('index.json')
export const DEV = MIG.machines as Record<'core1' | 'core2' | 'core3' | 'core4', string>
export const NET_ID = '0ff1ce00-0000-4000-8000-000000000001'
/** The flow captured on the real backend for core2 (central TOML, generated TOML and their parses). */
export const FLOW = migrateFixture<Record<string, any>>('flow-core2.json')

const nameOf = (id: string) => Object.entries(DEV).find(([, v]) => v === id)?.[0]

export interface MigrateMockOpts {
  /** Device names reported offline (their instances cannot be listed: 404 Client not found). */
  offline?: string[]
  /** Device names whose first instance listing fails with 500. */
  failRead?: string[]
  /** 'existing': a central network named office exists already. */
  network?: 'none' | 'existing'
  /** Per-device config overrides (merged into the captured config). */
  configs?: Partial<Record<string, Record<string, unknown>>>
}

/**
 * Matches a request: same method, path starting with `path`; with `device`, the device id must be
 * in the path or the body (e.g. `device_ids` of `POST /networks/{id}/members`).
 */
export interface RequestRule {
  method: string
  path: string
  device?: string
  /** Substring of the raw request body. */
  bodyIncludes?: string
}

export interface MigrateMockState {
  machines: () => unknown
  networkExists: boolean
  members: Record<string, unknown>[]
  /** Write requests answered with an error; the first matching rule wins. */
  failures: (RequestRule & { status: number; body: unknown })[]
  /** Requests held until `until` settles (checked before failures). */
  holds: (RequestRule & { until: Promise<void> })[]
  /** Per device name: the instance ids the device reports running and disabled. */
  instances: Record<string, { running: string[]; disabled: string[] }>
  /** Device names whose proxy-rpc answers 502. */
  rpcDown: string[]
  /** Per device name: the TOML `show_node_info` answers (default: the flow's central TOML). */
  nodeToml: Record<string, string>
  /** Device names whose instance list answers 404 Client not found (gone offline mid-test). */
  unreachable: string[]
}

function machinesWith(offline: string[]) {
  const data = migrateFixture('machines.json')
  for (const m of data.machines) {
    const name = m.info ? nameOf(idOf(m.info.machine_id)) : undefined
    if (name && offline.includes(name)) m.online = false
  }
  return data
}

function idOf(u: { part1: number; part2: number; part3: number; part4: number }): string {
  const h = [u.part1, u.part2, u.part3, u.part4].map((p) => (p >>> 0).toString(16).padStart(8, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function uuidObj(id: string) {
  const h = id.replace(/-/g, '')
  return { part1: parseInt(h.slice(0, 8), 16), part2: parseInt(h.slice(8, 16), 16), part3: parseInt(h.slice(16, 24), 16), part4: parseInt(h.slice(24), 16) }
}

export function officeNetwork() {
  return {
    network_id: NET_ID, display_name: 'office', network_name: 'office', networking_method: 'Manual',
    virtual_cidr: '10.150.0.0/24', secure_mode: false, member_count: 0, online_member_count: 0,
  }
}

const pathOf = (req: Request) => new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '')
const bodyOf = (req: Request): any => {
  try {
    return req.postDataJSON()
  } catch {
    return undefined
  }
}
/** The TOML without its `[source]` table (the page strips it before parse-config). */
const withoutSource = (toml: string) => toml.replace(/^\[source\][^[]*/m, '').trim()

function matches(rule: RequestRule, req: Request): boolean {
  const path = pathOf(req)
  if (rule.method !== req.method() || !path.startsWith(rule.path)) return false
  if (rule.bodyIncludes && !(req.postData() ?? '').includes(rule.bodyIncludes)) return false
  return !rule.device || path.includes(rule.device) || (req.postData() ?? '').includes(rule.device)
}

/**
 * Overrides answering the legacy inventory from `tests/fixtures/v2.7.1/migrate/` and the writes of
 * a migration (stateful: disabling, deleting and recreating instances, members joining and
 * leaving). The returned state may be changed by a test while it runs.
 */
export function migrateMock(opts: MigrateMockOpts = {}): { overrides: Overrides; state: MigrateMockState } {
  const offline = opts.offline ?? []
  const failOnce = new Set(opts.failRead ?? [])
  const instances: MigrateMockState['instances'] = {}
  for (const name of Object.keys(DEV)) {
    const list = migrateFixture(`instances-${name}.json`)
    instances[name] = { running: list.running_inst_ids.map(idOf), disabled: list.disabled_inst_ids.map(idOf) }
  }
  const state: MigrateMockState = {
    machines: () => machinesWith(offline),
    networkExists: opts.network === 'existing',
    members: [],
    failures: [],
    holds: [],
    instances,
    rpcDown: [],
    nodeToml: {},
    unreachable: [],
  }
  const configFor = (name: string, inst: string) => {
    const net = Object.entries(MIG.instances[name] ?? {}).find(([, id]) => id === inst)?.[0]
    if (!net) return null
    const running = state.instances[name]!.running.includes(inst)
    const base = migrateFixture(`${running ? 'config' : 'stored'}-${name}-${net}.json`)
    return { ...base, ...(opts.configs?.[name] ?? {}) }
  }
  const move = (name: string, inst: string, to: 'running' | 'disabled' | null) => {
    const s = state.instances[name]!
    s.running = s.running.filter((x) => x !== inst)
    s.disabled = s.disabled.filter((x) => x !== inst)
    if (to) s[to].push(inst)
  }
  /** Wraps a write: holds, then failures, then the handler. */
  const write = (handler: (req: Request) => unknown) => async (req: Request) => {
    for (const h of state.holds) if (matches(h, req)) await h.until
    const fail = state.failures.find((f) => matches(f, req))
    if (fail) return status(fail.status, fail.body)
    return handler(req)
  }

  const overrides: Overrides = {
    'GET /machines': () => state.machines(),
    'GET /networks': () => ({ networks: state.networkExists ? [officeNetwork()] : [] }),
    'POST /networks': write((req) => {
      state.networkExists = true
      return { ...officeNetwork(), network_secret: bodyOf(req)?.network_secret ?? 'office-secret', peer_urls: ['tcp://core1:11010'] }
    }),
    'GET /networks/gateway-info': () => ({ enabled: false }),
    'GET /networks/*/members': () => ({ members: state.members, temporary_peers: [] }),
    'POST /networks/*/members': write((req) => {
      for (const id of (bodyOf(req)?.device_ids ?? []) as string[]) {
        const name = nameOf(id) ?? id
        state.members.push({
          member_id: `m-${id}`, device_id: id, hostname: name, hostname_override: null, alias: null,
          virtual_ipv4: null, allocated_ipv4: null, online: true, running: true, runtime_virtual_ipv4: null,
          version: '2.6.4', error_msg: null, has_override: false, proxy_cidrs: [], temporary: false,
          credential_id: null, credential_expiry_unix: null,
        })
        if (state.instances[name]) move(name, NET_ID, 'running')
      }
      return {}
    }),
    'PUT /networks/*/members/*/config': write(() => ({})),
    'PATCH /networks/*/members/*': write((req) => {
      const id = pathOf(req).split('/')[4]!
      const m = state.members.find((x) => x.device_id === id)
      if (m) Object.assign(m, bodyOf(req) ?? {})
      return m ?? status(404, { message: 'member not found' })
    }),
    'DELETE /networks/*/members/*': write((req) => {
      const id = pathOf(req).split('/')[4]!
      const before = state.members.length
      state.members = state.members.filter((x) => x.device_id !== id)
      if (state.members.length === before) return status(404, { message: 'member not found' })
      const name = nameOf(id)
      if (name) move(name, NET_ID, null)
      return {}
    }),
    'GET /networks/*/acl-policy': () => ({ policy: { default_action: 'allow', rules: [] } }),
    'GET /networks/*': () =>
      state.networkExists ? { ...officeNetwork(), network_secret: 'office-secret', peer_urls: ['tcp://core1:11010'] } : status(404, { message: 'not found' }),
    'GET /machines/*/networks': (req) => {
      const id = pathOf(req).split('/')[2]!
      const name = nameOf(id)
      if (!name) return status(404, { message: 'Client not found' })
      if (offline.includes(name) || state.unreachable.includes(name)) return status(404, { message: 'Client not found' })
      if (failOnce.has(name)) {
        failOnce.delete(name)
        return status(500, { message: 'boom' })
      }
      const s = state.instances[name]!
      return { running_inst_ids: s.running.map(uuidObj), disabled_inst_ids: s.disabled.map(uuidObj) }
    },
    'POST /machines/*/networks': write((req) => {
      const name = nameOf(pathOf(req).split('/')[2]!)
      const inst = bodyOf(req)?.config?.instance_id
      if (name && typeof inst === 'string') move(name, inst, 'running')
      return {}
    }),
    'POST /machines/*/networks/metas': (req) => {
      const name = nameOf(pathOf(req).split('/')[2]!)
      return migrateFixture(`metas-${name}.json`)
    },
    'GET /machines/*/networks/config/*': (req) => {
      const parts = pathOf(req).split('/')
      const name = nameOf(parts[2]!)
      const cfg = name ? configFor(name, parts[5]!) : null
      return cfg ?? status(404, { message: 'No such network instance' })
    },
    'PUT /machines/*/networks/*': write((req) => {
      const parts = pathOf(req).split('/')
      const name = nameOf(parts[2]!)
      if (name) move(name, parts[4]!, bodyOf(req)?.disabled ? 'disabled' : 'running')
      return {}
    }),
    'DELETE /machines/*/networks/*': write((req) => {
      const parts = pathOf(req).split('/')
      const name = nameOf(parts[2]!)
      if (name) move(name, parts[4]!, null)
      return {}
    }),
    'POST /machines/*/proxy-rpc': (req) => {
      const name = nameOf(pathOf(req).split('/')[2]!) ?? ''
      if (state.rpcDown.includes(name)) return status(502, { message: 'Bad Gateway' })
      if (bodyOf(req)?.method_name !== 'show_node_info') return {}
      return { node_info: { config: state.nodeToml[name] ?? FLOW.centralToml } }
    },
    'POST /generate-config': () => ({ toml_config: FLOW.generatedFromStored, error: null }),
    'POST /parse-config': (req) => {
      const toml = withoutSource(String(bodyOf(req)?.toml_config ?? ''))
      if (toml === withoutSource(FLOW.centralToml)) return { config: FLOW.parsedCentral, error: null }
      if (toml === withoutSource(FLOW.generatedFromStored)) return { config: FLOW.parsedGenerated, error: null }
      return { config: { ...FLOW.parsedCentral, mtu: 1200 }, error: null }
    },
  }
  return { overrides, state }
}
