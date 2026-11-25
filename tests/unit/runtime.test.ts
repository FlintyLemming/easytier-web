import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import machinesFx from '../fixtures/v2.7.1/machines.json'
import networksFx from '../fixtures/v2.7.1/networks.json'
import membersFx from '../fixtures/v2.7.1/members.json'
import routesFx from '../fixtures/v2.7.1/list-route-core1.json'
import peersFx from '../fixtures/v2.7.1/list-peer-core1.json'

vi.mock('../../src/api/client', () => ({
  listMachines: vi.fn(),
  listNetworks: vi.fn(),
  listBlockedDevices: vi.fn(),
  listMembers: vi.fn(),
  nodeRoutes: vi.fn(),
  nodePeers: vi.fn(),
}))
import * as client from '../../src/api/client'
import { strToUuid } from '../../src/lib/uuid'
import { useInventory } from '../../src/stores/inventory'
import { useSession } from '../../src/stores/session'
import { useRuntime } from '../../src/stores/runtime'

const m = vi.mocked(client)
const CORE1 = '11111111-1111-4111-8111-111111111111'
const CORE2 = '22222222-2222-4222-8222-222222222222'
const CORE3 = '33333333-3333-4333-8333-333333333333'
const NET = networksFx.networks[0]!.network_id

/** The three fixture members as seen in each other's route tables (10.144.144.1–3). */
const NODES: Record<string, { peer: number; hostname: string; addr: number }> = {
  [CORE1]: { peer: 101, hostname: 'core1', addr: 177246209 },
  [CORE2]: { peer: 102, hostname: 'core2', addr: 177246210 },
  [CORE3]: { peer: 103, hostname: 'lab-box', addr: 177246211 },
}
/** `relayed[dev]` lists the devices `dev` reaches only through a relay; every other link is direct. */
let relayed: Record<string, string[]> = {}
const others = (dev: string) => Object.keys(NODES).filter((id) => id !== dev)
const routesOf = (dev: string) =>
  others(dev).map((id) => ({
    ...routesFx.routes[0]!,
    peer_id: NODES[id]!.peer,
    hostname: NODES[id]!.hostname,
    next_hop_peer_id: relayed[dev]?.includes(id) ? 999 : NODES[id]!.peer,
    path_latency: 30,
    ipv4_addr: { address: { addr: NODES[id]!.addr }, network_length: 24 },
  }))
const peersOf = (dev: string) =>
  others(dev)
    .filter((id) => !relayed[dev]?.includes(id))
    .map((id) => ({ peer_id: NODES[id]!.peer, conns: [peersFx.peer_infos[0]!.conns[0]!] }))

/** Holds every nodeRoutes answer until released; `release(dev)` answers one device, `release()` all. */
function deferred() {
  const pending = new Map<string, () => void>()
  m.nodeRoutes.mockImplementation((dev) => new Promise((r) => pending.set(dev, () => r(routesOf(dev) as never))))
  return (dev?: string) => {
    for (const [d, answer] of pending) if (dev === undefined || d === dev) answer()
  }
}

/** Ten online members of NET (machine ids …01 to …10) instead of the fixture three. */
function tenMembers(): string[] {
  const ids = Array.from({ length: 10 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
  const base = machinesFx.machines[0]!
  m.listMachines.mockResolvedValue(ids.map((id, i) => ({
    ...base, client_url: `udp://192.0.2.${i + 1}:1`, info: { ...base.info, machine_id: strToUuid(id), hostname: `n${i + 1}` },
  })) as never)
  m.listMembers.mockResolvedValue({
    ...membersFx,
    members: ids.map((id, i) => ({ ...membersFx.members[0]!, member_id: `m${i + 1}`, device_id: id, hostname: `n${i + 1}`, online: true })),
  } as never)
  return ids
}

/** Holds every nodeRoutes answer in call order and tracks how many are pending at once. */
function held() {
  const waiting: (() => void)[] = []
  let active = 0
  let max = 0
  m.nodeRoutes.mockImplementation((dev) => {
    max = Math.max(max, ++active)
    return new Promise((r) => waiting.push(() => { active--; r(routesOf(dev) as never) }))
  })
  return {
    releaseOne: () => waiting.shift()?.(),
    releaseAll: () => { for (const answer of waiting.splice(0)) answer() },
    get max() { return max },
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

/** Answers held calls until `p` settles (each answer may start the next target). */
async function drain(h: ReturnType<typeof held>, p: Promise<unknown>) {
  let done = false
  void p.then(() => { done = true })
  for (let i = 0; i < 100 && !done; i++) {
    h.releaseAll()
    await flush()
  }
  expect(done).toBe(true)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  relayed = {}
  m.listMachines.mockResolvedValue(machinesFx.machines as never)
  m.listNetworks.mockResolvedValue(networksFx.networks as never)
  m.listBlockedDevices.mockResolvedValue([])
  m.listMembers.mockResolvedValue(membersFx as never)
  m.nodeRoutes.mockImplementation(async (dev) => routesOf(dev) as never)
  m.nodePeers.mockImplementation(async (dev) => peersOf(dev) as never)
})

async function loadInventory() {
  await useInventory().refresh()
}

describe('runtime store', () => {
  it('refreshFleet fetches routes and peers once per online member', async () => {
    await loadInventory()
    const rt = useRuntime()
    expect(rt.fleetLoaded).toBe(false)
    await rt.refreshFleet()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(3)
    expect(m.nodePeers).toHaveBeenCalledTimes(3)
    for (const dev of [CORE1, CORE2, CORE3]) {
      expect(m.nodeRoutes).toHaveBeenCalledWith(dev, NET)
      expect(m.nodePeers).toHaveBeenCalledWith(dev, NET)
    }
    expect(rt.fleetLoaded).toBe(true)
    expect(Object.keys(rt.fleetLinks[NET]!).sort()).toEqual([CORE1, CORE2, CORE3])
    expect(rt.pairs.map((p) => [p.a, p.b])).toEqual([[CORE1, CORE2], [CORE1, CORE3], [CORE2, CORE3]])
    expect(rt.stats).toEqual({ direct: 3, relayed: 0, rate: 1 })
    expect(rt.errors).toEqual({})
  })

  it('a failing device is reported in errors and left out of the stats', async () => {
    relayed = { [CORE3]: [CORE2] } // only core2 reports the core2–core3 link as direct
    m.nodePeers.mockImplementation(async (dev) => {
      if (dev === CORE2) throw new Error('timeout')
      return peersOf(dev) as never
    })
    await loadInventory()
    const rt = useRuntime()
    await rt.refreshFleet()
    expect(rt.errors).toEqual({ [rt.runtimeKey(CORE2, NET)]: 'timeout' })
    expect(Object.keys(rt.fleetLinks[NET]!).sort()).toEqual([CORE1, CORE3])
    expect(rt.stats).toEqual({ direct: 2, relayed: 1, rate: 2 / 3 })
    expect(rt.pairs.find((p) => p.direct === false)).toMatchObject({ a: CORE3, b: CORE2, mode: { type: 'relay' }, latencyMs: 30 })
    expect(rt.fleetLoaded).toBe(true)
  })

  it('fleetReady once one target has answered: a device still pending holds back nothing', async () => {
    await loadInventory()
    const release = deferred()
    const rt = useRuntime()
    const p = rt.refreshFleet()
    expect(rt.fleetReady).toBe(false)
    release(CORE1)
    await vi.waitFor(() => expect(rt.fleetReady).toBe(true))
    expect(rt.fleetLoaded).toBe(false)
    // core1 alone reports both of its links: two pairs, both direct.
    expect(rt.stats).toEqual({ direct: 2, relayed: 0, rate: 1 })
    release()
    await p
    expect(rt.fleetReady).toBe(true)
    expect(rt.stats).toEqual({ direct: 3, relayed: 0, rate: 1 })
  })

  it('fleetReady keeps what a cancelled pass already fetched (leaving the overview mid-pass)', async () => {
    tenMembers()
    await loadInventory()
    const h = held()
    const rt = useRuntime()
    const p = rt.refreshFleet()
    await flush()
    rt.cancelFleet()
    h.releaseAll()
    await p
    expect(rt.fleetLoaded).toBe(false)
    expect(rt.fleetReady).toBe(true)
  })

  it('fleetReady after a finished pass even when every target failed', async () => {
    m.nodeRoutes.mockRejectedValue(new Error('timeout'))
    await loadInventory()
    const rt = useRuntime()
    await rt.refreshFleet()
    expect(rt.fleetReady).toBe(true)
    expect(rt.stats).toEqual({ direct: 0, relayed: 0, rate: null })
  })

  // Pinia wraps every promise an action returns (`ret.then(...)`), so the two calls cannot hand back the
  // identical object; what matters is that the second call joins the refresh in flight.
  it('refreshFleet is single-flight: a call during a refresh joins it', async () => {
    await loadInventory()
    const release = deferred()
    const rt = useRuntime()
    const a = rt.refreshFleet()
    release(CORE1)
    await vi.waitFor(() => expect(rt.entries[rt.runtimeKey(CORE1, NET)]).toBeDefined())
    let bDone = false
    const b = rt.refreshFleet().then(() => { bDone = true })
    await Promise.resolve()
    // A second refresh would ask core1 again: its own fetch has already finished.
    expect(m.nodeRoutes).toHaveBeenCalledTimes(3)
    expect(m.nodePeers).toHaveBeenCalledTimes(3)
    expect(bDone).toBe(false)
    expect(rt.fleetLoaded).toBe(false)
    release()
    await Promise.all([a, b])
    expect(m.nodeRoutes).toHaveBeenCalledTimes(3)
    expect(m.nodePeers).toHaveBeenCalledTimes(3)
    expect(rt.fleetLoaded).toBe(true)
  })

  it('offline members are not fetched', async () => {
    m.listMembers.mockResolvedValue({
      ...membersFx,
      members: membersFx.members.map((x) => (x.device_id === CORE2 ? { ...x, online: false } : x)),
    } as never)
    await loadInventory()
    const rt = useRuntime()
    expect(rt.fleetTargets).toEqual([
      { deviceId: CORE3, networkId: NET },
      { deviceId: CORE1, networkId: NET },
    ])
    await rt.refreshFleet()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(2)
    expect(m.nodeRoutes).not.toHaveBeenCalledWith(CORE2, NET)
    expect(m.nodePeers).not.toHaveBeenCalledWith(CORE2, NET)
  })

  it('does nothing before the inventory has loaded', async () => {
    const rt = useRuntime()
    await rt.refreshFleet()
    expect(m.nodeRoutes).not.toHaveBeenCalled()
    expect(m.nodePeers).not.toHaveBeenCalled()
    expect(rt.fleetLoaded).toBe(false)
  })

  it('reset drops results of requests still in flight', async () => {
    await loadInventory()
    const release = deferred()
    const rt = useRuntime()
    const p = rt.refreshFleet()
    await Promise.resolve()
    rt.reset()
    release()
    await p
    expect(rt.entries).toEqual({})
    expect(rt.errors).toEqual({})
    expect(rt.fleetLoaded).toBe(false)
    expect(rt.stats).toEqual({ direct: 0, relayed: 0, rate: null })
  })

  it('refreshFleet keeps at most 4 targets in flight', async () => {
    tenMembers()
    await loadInventory()
    const h = held()
    const rt = useRuntime()
    expect(rt.fleetTargets).toHaveLength(10)
    const p = rt.refreshFleet()
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(4)
    expect(m.nodePeers).toHaveBeenCalledTimes(4)
    // One answer frees one slot: exactly one more target starts.
    h.releaseOne()
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(5)
    expect(m.nodePeers).toHaveBeenCalledTimes(5)
    await drain(h, p)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(10)
    expect(m.nodePeers).toHaveBeenCalledTimes(10)
    expect(h.max).toBe(4)
    expect(Object.keys(rt.entries)).toHaveLength(10)
    expect(rt.fleetLoaded).toBe(true)
  })

  it('cancelFleet lets in-flight targets finish and starts no more; the next refresh starts afresh', async () => {
    tenMembers()
    await loadInventory()
    const h = held()
    const rt = useRuntime()
    const p = rt.refreshFleet()
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(4)
    rt.cancelFleet()
    h.releaseAll()
    await p
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(4)
    expect(m.nodePeers).toHaveBeenCalledTimes(4)
    expect(Object.keys(rt.entries)).toHaveLength(4)
    expect(rt.fleetLoaded).toBe(false)

    const q = rt.refreshFleet()
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(8)
    await drain(h, q)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(14)
    expect(rt.fleetLoaded).toBe(true)

    // Cancelling never clears fleetLoaded.
    const r = rt.refreshFleet()
    await flush()
    rt.cancelFleet()
    h.releaseAll()
    await r
    expect(rt.fleetLoaded).toBe(true)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(18)
  })

  it('reset cancels the fleet pass', async () => {
    tenMembers()
    await loadInventory()
    const h = held()
    const rt = useRuntime()
    const p = rt.refreshFleet()
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(4)
    rt.reset()
    h.releaseAll()
    await p
    await flush()
    expect(m.nodeRoutes).toHaveBeenCalledTimes(4)
    expect(m.nodePeers).toHaveBeenCalledTimes(4)
    expect(rt.entries).toEqual({})
    expect(rt.fleetLoaded).toBe(false)
  })

  it('fetch: single-flight per key, never rejects, an error keeps the previous entry', async () => {
    await loadInventory()
    const rt = useRuntime()
    expect(rt.linksFor(CORE1, NET)).toBeNull()
    await Promise.all([rt.fetch(CORE1, NET), rt.fetch(CORE1, NET)])
    expect(m.nodeRoutes).toHaveBeenCalledTimes(1)
    const entry = rt.entries[rt.runtimeKey(CORE1, NET)]
    expect(entry?.routes).toHaveLength(2)
    expect(rt.linksFor(CORE1, NET)?.map((l) => [l.name, l.kind, l.mode.type])).toEqual([
      ['core2', 'member', 'p2p'],
      ['core3', 'member', 'p2p'],
    ])
    m.nodeRoutes.mockRejectedValueOnce(new Error('boom'))
    await expect(rt.fetch(CORE1, NET)).resolves.toBeUndefined()
    expect(rt.errors[rt.runtimeKey(CORE1, NET)]).toBe('boom')
    expect(rt.entries[rt.runtimeKey(CORE1, NET)]).toBe(entry)
    rt.clearError(CORE1, NET)
    expect(rt.errors).toEqual({})
  })

  it('webhook mode has no fleet targets', async () => {
    await loadInventory()
    useSession().info = { webhook_auth: true } as never
    const rt = useRuntime()
    expect(rt.fleetTargets).toEqual([])
    await rt.refreshFleet()
    expect(m.nodeRoutes).not.toHaveBeenCalled()
  })
})
