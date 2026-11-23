import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import machinesFx from '../fixtures/v2.7.1/machines.json'
import networksFx from '../fixtures/v2.7.1/networks.json'
import membersFx from '../fixtures/v2.7.1/members.json'

vi.mock('../../src/api/client', () => ({
  listMachines: vi.fn(),
  listNetworks: vi.fn(),
  listBlockedDevices: vi.fn(),
  listMembers: vi.fn(),
  getConsoleInfo: vi.fn(),
}))
import * as client from '../../src/api/client'
import { useInventory } from '../../src/stores/inventory'
import { useSession } from '../../src/stores/session'

const m = vi.mocked(client)
const net = networksFx.networks[0]!

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  m.listMachines.mockResolvedValue(machinesFx.machines as never)
  m.listNetworks.mockResolvedValue(networksFx.networks as never)
  m.listBlockedDevices.mockResolvedValue([])
  m.listMembers.mockResolvedValue(membersFx as never)
})

describe('inventory', () => {
  it('refresh is single-flight', async () => {
    const inv = useInventory()
    const a = inv.refresh()
    const b = inv.refresh()
    await Promise.all([a, b])
    expect(m.listMachines).toHaveBeenCalledTimes(1)
  })

  it('refresh loads members for every network', async () => {
    m.listNetworks.mockResolvedValue([net, { ...net, network_id: 'second-net', member_count: 0 }] as never)
    const inv = useInventory()
    await inv.refresh()
    expect(m.listMembers).toHaveBeenCalledTimes(2)
    expect(inv.loaded).toBe(true)
    expect(inv.error).toBeNull()
    expect(inv.primaryNetwork?.network_id).toBe(net.network_id)
    expect(inv.devices.some((d) => d.ip)).toBe(true)
    const d = inv.devices[0]!
    expect(inv.deviceById(d.id)).toBe(d)
  })

  it('refresh error keeps last good data', async () => {
    const inv = useInventory()
    await inv.refresh()
    const before = inv.devices.map((d) => d.id)
    expect(before.length).toBeGreaterThan(0)
    m.listMachines.mockRejectedValue(new Error('boom'))
    await expect(inv.refresh()).resolves.toBeUndefined()
    expect(inv.devices.map((d) => d.id)).toEqual(before)
    expect(inv.error).toBe('boom')
  })

  it('keeps temporary peers per network, all-or-nothing like members', async () => {
    const temp = { peer_id: 7, credential_id: 'c1', credential_expiry_unix: null, hostname: 'phone', ipv4: '10.144.144.50/24', version: null }
    m.listMembers.mockResolvedValue({ ...membersFx, temporary_peers: [temp] } as never)
    const inv = useInventory()
    await inv.refresh()
    expect(inv.temporaryByNetwork).toEqual({ [net.network_id]: [temp] })
    m.listMembers.mockRejectedValue(new Error('members down'))
    await inv.refresh()
    expect(inv.temporaryByNetwork).toEqual({ [net.network_id]: [temp] })
  })

  it('a failing listMembers fails the whole refresh', async () => {
    const inv = useInventory()
    await inv.refresh()
    m.listMembers.mockRejectedValue(new Error('members down'))
    m.listBlockedDevices.mockResolvedValue([{ id: 'x' }] as never)
    await inv.refresh()
    expect(inv.error).toBe('members down')
    expect(inv.blocked).toEqual([])
  })
})

describe('inventory reset', () => {
  it('clears all state', async () => {
    m.listBlockedDevices.mockResolvedValue([{ id: 'b', attempt_count: 1 }] as never)
    const inv = useInventory()
    await inv.refresh()
    expect(inv.machines.length).toBeGreaterThan(0)
    expect(inv.blocked).toHaveLength(1)
    expect(Object.keys(inv.temporaryByNetwork)).toHaveLength(1)
    inv.reset()
    expect(inv.machines).toEqual([])
    expect(inv.networks).toEqual([])
    expect(inv.membersByNetwork).toEqual({})
    expect(inv.temporaryByNetwork).toEqual({})
    expect(inv.blocked).toEqual([])
    expect(inv.loaded).toBe(false)
    expect(inv.error).toBeNull()
  })

  it('a refresh in flight during reset does not write afterwards', async () => {
    let release!: (v: never) => void
    m.listMachines.mockReturnValue(new Promise((r) => { release = r as never }))
    const inv = useInventory()
    const p = inv.refresh()
    inv.reset()
    release(machinesFx.machines as never)
    await p
    expect(inv.machines).toEqual([])
    expect(inv.networks).toEqual([])
    expect(inv.loaded).toBe(false)
    // and a fresh refresh after reset still works
    m.listMachines.mockResolvedValue(machinesFx.machines as never)
    await inv.refresh()
    expect(inv.loaded).toBe(true)
  })

  it('a failing in-flight refresh does not set error after reset', async () => {
    let fail!: (e: Error) => void
    m.listMachines.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    const inv = useInventory()
    const p = inv.refresh()
    inv.reset()
    fail(new Error('boom'))
    await p
    expect(inv.error).toBeNull()
  })
})

describe('session', () => {
  it('load sets info and getters; errors propagate', async () => {
    const s = useSession()
    expect(s.username).toBe('')
    m.getConsoleInfo.mockResolvedValue({ username: 'bob', webhook_auth: false } as never)
    await s.load()
    expect(s.username).toBe('bob')
    expect(s.centralEnabled).toBe(true)
    s.reset()
    expect(s.info).toBeNull()
    m.getConsoleInfo.mockRejectedValue(new Error('401'))
    await expect(s.load()).rejects.toThrow('401')
  })
})
