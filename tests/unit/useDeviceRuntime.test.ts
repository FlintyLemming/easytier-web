import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
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
import { useInventory } from '../../src/stores/inventory'
import { useDeviceRuntime } from '../../src/composables/useDeviceRuntime'

const m = vi.mocked(client)
const CORE1 = '11111111-1111-4111-8111-111111111111'
const NET = networksFx.networks[0]!.network_id

let scope: EffectScope | null = null

beforeEach(async () => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  vi.resetAllMocks()
  m.listMachines.mockResolvedValue(machinesFx.machines as never)
  m.listNetworks.mockResolvedValue(networksFx.networks as never)
  m.listBlockedDevices.mockResolvedValue([])
  m.listMembers.mockResolvedValue(membersFx as never)
  m.nodeRoutes.mockResolvedValue(routesFx.routes as never)
  m.nodePeers.mockResolvedValue(peersFx.peer_infos as never)
  await useInventory().refresh()
  m.listMembers.mockClear()
})

afterEach(() => {
  scope?.stop()
  scope = null
  vi.useRealTimers()
})

function setup(o: { online?: boolean; networkId?: string | null } = {}) {
  const deviceId = ref(CORE1)
  const networkId = ref<string | null>(o.networkId === undefined ? NET : o.networkId)
  const online = ref(o.online ?? true)
  scope = effectScope()
  const rt = scope.run(() => useDeviceRuntime(deviceId, networkId, online))!
  return { rt, deviceId, networkId, online }
}

describe('useDeviceRuntime', () => {
  it('offline: never requests and links stay null', async () => {
    const { rt } = setup({ online: false })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(m.nodeRoutes).not.toHaveBeenCalled()
    expect(m.nodePeers).not.toHaveBeenCalled()
    expect(m.listMembers).not.toHaveBeenCalled()
    expect(rt.links.value).toBeNull()
  })

  it('no network: never requests', async () => {
    const { rt } = setup({ networkId: null })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(m.nodeRoutes).not.toHaveBeenCalled()
    expect(rt.links.value).toBeNull()
  })

  it('online: fetches routes+peers every 15s and never lists members itself', async () => {
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.nodeRoutes).toHaveBeenCalledWith(CORE1, NET)
    expect(m.nodePeers).toHaveBeenCalledWith(CORE1, NET)
    expect(m.listMembers).not.toHaveBeenCalled()
    expect(rt.links.value?.map((l) => l.name).sort()).toEqual(['core2', 'core3'])
    expect(rt.error.value).toBeNull()
    await vi.advanceTimersByTimeAsync(14_000)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(3)
    expect(m.listMembers).not.toHaveBeenCalled()
  })

  it('temporary peers come from the store, so late joiners are relabelled', async () => {
    const phone = {
      peer_id: 999, hostname: 'phone', cost: 1, path_latency: 3, proxy_cidrs: [], version: '', next_hop_peer_id: 999,
      ipv4_addr: { address: { addr: 177246258 } }, // 10.144.144.50
    }
    m.nodeRoutes.mockResolvedValue([...routesFx.routes, phone] as never)
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.links.value?.find((l) => l.peerId === 999)?.kind).toBe('infra')
    const inv = useInventory()
    inv.temporaryByNetwork = {
      [NET]: [{ peer_id: 999, credential_id: 'c', credential_expiry_unix: null, hostname: 'phone', ipv4: '10.144.144.50/24', version: null }],
    }
    await nextTick()
    expect(rt.links.value?.find((l) => l.peerId === 999)?.kind).toBe('temporary')
    expect(m.listMembers).not.toHaveBeenCalled()
  })

  it('names follow the inventory (alias wins)', async () => {
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const inv = useInventory()
    inv.machines = inv.machines.map((x) => (x.info?.hostname === 'core2' ? { ...x, alias: '书房' } : x))
    await nextTick()
    expect(rt.links.value?.map((l) => l.name).sort()).toEqual(['core3', '书房'])
  })

  it('errors set error, keep polling, and recover', async () => {
    m.nodeRoutes.mockRejectedValueOnce(new Error('boom'))
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.error.value).toBe('boom')
    expect(rt.links.value).toBeNull()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(2)
    expect(rt.error.value).toBeNull()
    expect(rt.links.value).toHaveLength(2)
  })

  it('retry fetches immediately', async () => {
    m.nodeRoutes.mockRejectedValueOnce(new Error('boom'))
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.error.value).toBe('boom')
    rt.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(2)
    expect(rt.error.value).toBeNull()
  })

  it('retry while a fetch is in flight does not start a second one', async () => {
    let release!: () => void
    m.nodeRoutes.mockImplementationOnce(
      () => new Promise((r) => { release = () => r(routesFx.routes as never) }),
    )
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.loading.value).toBe(true)
    rt.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.links.value).toHaveLength(2)
    expect(rt.loading.value).toBe(false)
  })

  it('going offline stops polling and clears links', async () => {
    const { rt, online } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.links.value).not.toBeNull()
    online.value = false
    await nextTick()
    expect(rt.links.value).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(m.nodeRoutes).toHaveBeenCalledTimes(1)
  })

  it('switching network refetches and drops a stale in-flight result', async () => {
    let release!: () => void
    m.nodeRoutes.mockImplementationOnce(
      () => new Promise((r) => { release = () => r(routesFx.routes as never) }),
    )
    const { rt, networkId } = setup()
    await vi.advanceTimersByTimeAsync(0)
    networkId.value = 'other-net'
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.nodeRoutes).toHaveBeenLastCalledWith(CORE1, 'other-net')
    expect(m.listMembers).not.toHaveBeenCalled()
    const afterSwitch = rt.links.value
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.links.value).toBe(afterSwitch)
  })

  it("labels infra nodes from the network's networking_method (Gateway → gateway, else server)", async () => {
    const infraRoute = { ...routesFx.routes[0]!, peer_id: 4242, hostname: 'et-web-gateway', ipv4_addr: null, next_hop_peer_id: 4242 }
    m.nodeRoutes.mockResolvedValue([...routesFx.routes, infraRoute] as never)
    const { rt } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.links.value?.find((l) => l.peerId === 4242)).toMatchObject({ kind: 'infra', infra: 'server' })
    // The inventory says the network is a Gateway network now; the computed links follow.
    useInventory().networks = [{ ...networksFx.networks[0]!, networking_method: 'Gateway' }]
    await nextTick()
    expect(rt.links.value?.find((l) => l.peerId === 4242)).toMatchObject({ kind: 'infra', infra: 'gateway' })
  })
})
