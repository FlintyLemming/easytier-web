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
