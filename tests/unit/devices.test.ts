import { describe, expect, it } from 'vitest'
import machinesFx from '../fixtures/v2.7.1/machines.json'
import networksFx from '../fixtures/v2.7.1/networks.json'
import membersFx from '../fixtures/v2.7.1/members.json'
import type { CentralNetworkMember, CentralNetworkSummary, RawMachine } from '../../src/api/types'
import { buildDeviceViews, defaultNetworkId, memberIp, primaryNetworkId } from '../../src/domain/devices'

const machines = machinesFx.machines as unknown as RawMachine[]
const networks = networksFx.networks as unknown as CentralNetworkSummary[]
const members = membersFx.members as unknown as CentralNetworkMember[]
const netId = networks[0]!.network_id
const byNet = { [netId]: members }
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const net = (n: number, id = String(n)) => ({ network_id: id, member_count: n }) as CentralNetworkSummary

describe('primaryNetworkId / defaultNetworkId', () => {
  it('picks first network with max member count', () => {
    expect(primaryNetworkId([net(3, 'a'), net(5, 'b'), net(5, 'c')])).toBe('b')
    expect(primaryNetworkId([])).toBeNull()
  })
  it('defaultNetworkId', () => {
    expect(defaultNetworkId(['b', 'a'], 'a')).toBe('a')
    expect(defaultNetworkId(['b', 'c'], 'a')).toBe('b')
    expect(defaultNetworkId([], 'a')).toBeNull()
  })
})

describe('memberIp', () => {
  const m = (o: Partial<CentralNetworkMember>) => o as CentralNetworkMember
  it('priority and prefix stripping', () => {
    expect(memberIp(m({ runtime_virtual_ipv4: '10.144.144.1/24', virtual_ipv4: '1.1.1.1', allocated_ipv4: '2.2.2.2' }))).toBe('10.144.144.1')
    expect(memberIp(m({ runtime_virtual_ipv4: null, virtual_ipv4: '1.1.1.1/24', allocated_ipv4: '2.2.2.2' }))).toBe('1.1.1.1')
    expect(memberIp(m({ runtime_virtual_ipv4: null, virtual_ipv4: null, allocated_ipv4: '2.2.2.2' }))).toBe('2.2.2.2')
    expect(memberIp(m({ runtime_virtual_ipv4: null, virtual_ipv4: null }))).toBeNull()
  })
})

describe('buildDeviceViews', () => {
  it('builds views from fixtures', () => {
    const views = buildDeviceViews(machines, networks, byNet)
    expect(views).toHaveLength(machines.length)
    const core1 = views.find((v) => v.hostname === 'core1')!
    expect(core1.ip).toBe('10.144.144.1')
    expect(core1.defaultNetworkId).toBe(netId)
    expect(core1.member?.device_id).toBe(core1.id)
    expect(core1.networks).toEqual([{ id: netId, name: 'home-central' }])
    expect(core1.location).toEqual({ country: '本地网络', city: null, region: null })
    expect(core1.version).toBe('2.6.4-8428a89d')
    expect(core1.outdated).toBe(false) // newest among the fleet
    expect(core1.os).toBeTruthy()
  })
  it('name falls back alias -> hostname -> id', () => {
    const m = clone(machines[0]!)
    m.alias = 'My Box'
    expect(buildDeviceViews([m], networks, byNet)[0]!.name).toBe('My Box')
    m.alias = ''
    expect(buildDeviceViews([m], networks, byNet)[0]!.name).toBe(m.info!.hostname)
    m.info!.hostname = ''
    const v = buildDeviceViews([m], networks, byNet)[0]!
    expect(v.name).toBe(v.id)
    expect(v.hostname).toBe('')
  })
  it('device without networks', () => {
    const m = clone(machines[0]!)
    m.networks = []
    const v = buildDeviceViews([m], networks, byNet)[0]!
    expect(v.defaultNetworkId).toBeNull()
    expect(v.ip).toBeNull()
    expect(v.member).toBeNull()
  })
  it('null location and missing optional fields do not throw', () => {
    const m = clone(machines[0]!)
    m.location = null
    delete m.online
    delete m.last_seen
    const v = buildDeviceViews([m], networks, byNet)[0]!
    expect(v.location).toBeNull()
    expect(v.online).toBe(false)
    expect(v.lastSeen).toBeNull()
  })
  it('flags outdated against fleet maximum', () => {
    const a = clone(machines[0]!)
    const b = clone(machines[1]!)
    b.info!.easytier_version = '2.7.1-abc'
    const [va, vb] = buildDeviceViews([a, b], networks, byNet)
    expect(va!.outdated).toBe(true)
    expect(vb!.outdated).toBe(false)
  })
})
