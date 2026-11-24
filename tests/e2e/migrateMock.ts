import type { Request } from '@playwright/test'
import { migrateFixture, status, type Overrides } from './mockApi'

/** The migration rehearsal env as fixtures: core1..4, legacy instances, no central network yet. */
export const MIG = migrateFixture<{ machines: Record<string, string>; instances: Record<string, Record<string, string>> }>('index.json')
export const DEV = MIG.machines as Record<'core1' | 'core2' | 'core3' | 'core4', string>
export const NET_ID = '0ff1ce00-0000-4000-8000-000000000001'

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

export interface MigrateMockState {
  machines: () => unknown
  networkExists: boolean
  members: Record<string, unknown>[]
  /** Write requests answered with an error: key 'METHOD /path-prefix', checked with startsWith. */
  failures: Record<string, { status: number; body: unknown }>
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

export function officeNetwork() {
  return {
    network_id: NET_ID, display_name: 'office', network_name: 'office', networking_method: 'Manual',
    virtual_cidr: '10.150.0.0/24', secure_mode: false, member_count: 0, online_member_count: 0,
  }
}

const pathOf = (req: Request) => new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '')

/**
 * Overrides answering the legacy inventory from `tests/fixtures/v2.7.1/migrate/`. The returned
 * state may be changed by a test while it runs (overrides read it on every request).
 */
export function migrateMock(opts: MigrateMockOpts = {}): { overrides: Overrides; state: MigrateMockState } {
  const offline = opts.offline ?? []
  const failOnce = new Set(opts.failRead ?? [])
  const state: MigrateMockState = {
    machines: () => machinesWith(offline),
    networkExists: opts.network === 'existing',
    members: [],
    failures: {},
  }
  const configFor = (name: string, inst: string) => {
    const net = Object.entries(MIG.instances[name] ?? {}).find(([, id]) => id === inst)?.[0]
    if (!net) return null
    const running = migrateFixture(`instances-${name}.json`).running_inst_ids.map(idOf).includes(inst)
    const base = migrateFixture(`${running ? 'config' : 'stored'}-${name}-${net}.json`)
    return { ...base, ...(opts.configs?.[name] ?? {}) }
  }
  const overrides: Overrides = {
    'GET /machines': () => state.machines(),
    'GET /networks': () => ({ networks: state.networkExists ? [officeNetwork()] : [] }),
    'GET /networks/gateway-info': () => ({ enabled: false }),
    'GET /networks/*/members': () => ({ members: state.members, temporary_peers: [] }),
    'GET /networks/*/acl-policy': () => ({ policy: { default_action: 'allow', rules: [] } }),
    'GET /networks/*': () =>
      state.networkExists ? { ...officeNetwork(), network_secret: 'office-secret', peer_urls: ['tcp://core1:11010'] } : status(404, { message: 'not found' }),
    'GET /machines/*/networks': (req) => {
      const id = pathOf(req).split('/')[2]!
      const name = nameOf(id)
      if (!name) return status(404, { message: 'Client not found' })
      if (offline.includes(name)) return status(404, { message: 'Client not found' })
      if (failOnce.has(name)) {
        failOnce.delete(name)
        return status(500, { message: 'boom' })
      }
      return migrateFixture(`instances-${name}.json`)
    },
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
  }
  return { overrides, state }
}
