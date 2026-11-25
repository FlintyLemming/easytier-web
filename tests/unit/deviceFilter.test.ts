import { describe, expect, it } from 'vitest'
import machinesFx from '../fixtures/v2.7.1/machines.json'
import networksFx from '../fixtures/v2.7.1/networks.json'
import membersFx from '../fixtures/v2.7.1/members.json'
import type { CentralNetworkMember, CentralNetworkSummary, RawMachine } from '../../src/api/types'
import { buildDeviceViews, type DeviceView } from '../../src/domain/devices'
import { filterDevices, nextSort, sortDevices, statusCounts } from '../../src/domain/deviceFilter'

const machines = machinesFx.machines as unknown as RawMachine[]
const networks = networksFx.networks as unknown as CentralNetworkSummary[]
const members = membersFx.members as unknown as CentralNetworkMember[]
const devices = buildDeviceViews(machines, networks, { [networks[0]!.network_id]: members })

const dev = (o: Partial<DeviceView>): DeviceView => ({
  id: 'x', name: 'x', hostname: 'x', alias: null, os: '', online: true, lastSeen: null, version: '2.7.1',
  outdated: false, publicIp: null, location: null, knownLocation: o.location ?? null, locationCached: false, networks: [], defaultNetworkId: null, member: null, ip: null, pending: false, ...o,
})

describe('filterDevices', () => {
  it('matches ip', () => {
    const r = filterDevices(devices, { query: '10.144.144.3', status: 'all' })
    expect(r.map((d) => d.name)).toEqual(['core3'])
  })
  it('matches city, case-insensitively on name', () => {
    const ds = [dev({ id: 'a', name: 'Alpha', location: { city: '杭州', region: null, country: '中国' } }), dev({ id: 'b', name: 'beta' })]
    expect(filterDevices(ds, { query: '杭州', status: 'all' }).map((d) => d.id)).toEqual(['a'])
    expect(filterDevices(ds, { query: 'ALPHA', status: 'all' }).map((d) => d.id)).toEqual(['a'])
  })
  it('matches hostname and public ip', () => {
    const ds = [dev({ id: 'a', hostname: 'Box', publicIp: '1.2.3.4' }), dev({ id: 'b' })]
    expect(filterDevices(ds, { query: 'box', status: 'all' })).toHaveLength(1)
    expect(filterDevices(ds, { query: '1.2.3', status: 'all' })).toHaveLength(1)
  })
  it('unjoined only returns devices without a default network', () => {
    const ds = [...devices, dev({ id: 'u', name: 'u' })]
    expect(filterDevices(ds, { query: '', status: 'unjoined' }).map((d) => d.id)).toEqual(['u'])
  })
  it('city filter and online/offline', () => {
    const ds = [
      dev({ id: 'a', location: { city: '上海', region: null, country: '' } }),
      dev({ id: 'b', online: false, location: { city: '上海', region: null, country: '' } }),
      dev({ id: 'c', location: { city: '北京', region: null, country: '' } }),
    ]
    expect(filterDevices(ds, { query: '', status: 'all', city: '上海' }).map((d) => d.id)).toEqual(['a', 'b'])
    expect(filterDevices(ds, { query: '', status: 'offline', city: '上海' }).map((d) => d.id)).toEqual(['b'])
    expect(filterDevices(ds, { query: '', status: 'online' }).map((d) => d.id)).toEqual(['a', 'c'])
  })
})

describe('filterDevices city array / knownLocation', () => {
  const geo = (city: string) => ({ city, region: null, country: '中国' })
  const ds = [
    dev({ id: 'a', knownLocation: geo('杭州') }),
    dev({ id: 'b', knownLocation: geo('上海') }),
    dev({ id: 'c', knownLocation: geo('北京') }),
    dev({ id: 'd', online: false, knownLocation: geo('杭州'), locationCached: true }),
  ]
  it('matches any of several cities', () => {
    expect(filterDevices(ds, { query: '', status: 'all', city: ['杭州', '上海'] }).map((d) => d.id)).toEqual(['a', 'b', 'd'])
  })
  it('matches offline devices through knownLocation, also in search', () => {
    expect(filterDevices(ds, { query: '', status: 'offline', city: '杭州' }).map((d) => d.id)).toEqual(['d'])
    expect(filterDevices(ds, { query: '杭州', status: 'offline' }).map((d) => d.id)).toEqual(['d'])
  })
})

describe('sortDevices', () => {
  it('default: online first then name', () => {
    const ds = [dev({ id: '1', name: 'b', online: false }), dev({ id: '2', name: 'z' }), dev({ id: '3', name: 'a' })]
    expect(sortDevices(ds).map((d) => d.id)).toEqual(['3', '2', '1'])
  })
  it('by key and dir; missing values last', () => {
    const ds = [dev({ id: '1', ip: '10.0.0.2' }), dev({ id: '2', ip: null }), dev({ id: '3', ip: '10.0.0.10' })]
    expect(sortDevices(ds, 'ip', 'asc').map((d) => d.id)).toEqual(['1', '3', '2'])
    expect(sortDevices(ds, 'ip', 'desc').map((d) => d.id)).toEqual(['3', '1', '2'])
  })
  it('does not mutate input', () => {
    const ds = [dev({ id: '1', name: 'b' }), dev({ id: '2', name: 'a' })]
    sortDevices(ds, 'name', 'asc')
    expect(ds[0]!.id).toBe('1')
  })
})

describe('nextSort', () => {
  it('a header click cycles ascending → descending → default order', () => {
    expect(nextSort(null, 'ip')).toEqual({ key: 'ip', dir: 'asc' })
    expect(nextSort({ key: 'ip', dir: 'asc' }, 'ip')).toEqual({ key: 'ip', dir: 'desc' })
    expect(nextSort({ key: 'ip', dir: 'desc' }, 'ip')).toBeNull()
  })
  it('another column starts ascending', () => {
    expect(nextSort({ key: 'ip', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('statusCounts', () => {
  it('matches the fixture', () => {
    expect(statusCounts(devices)).toEqual({ all: 3, online: 3, offline: 0, unjoined: 0 })
  })
})
