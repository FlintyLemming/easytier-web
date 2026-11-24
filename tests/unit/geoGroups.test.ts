import { describe, expect, it } from 'vitest'
import type { GeoText } from '../../src/api/types'
import type { DeviceView } from '../../src/domain/devices'
import { summarizeLocations } from '../../src/domain/geo/groups'

function dev(id: string, name: string, online: boolean, geo: GeoText | null, cached = false): DeviceView {
  return {
    id, name, hostname: name, alias: null, os: '', online, lastSeen: null, version: '', outdated: false,
    publicIp: null, location: cached ? null : geo, knownLocation: geo, locationCached: cached,
    networks: [], defaultNetworkId: null, member: null, ip: null, pending: false,
  }
}
const sh: GeoText = { country: '中国', region: '上海', city: '上海' }

describe('summarizeLocations', () => {
  it('groups by place and fills the local and unlocated buckets', () => {
    const s = summarizeLocations([
      dev('1', 'b', true, sh),
      dev('2', 'a', true, sh),
      dev('3', 'c', false, sh, true),
      dev('4', 'l', true, { country: '本地网络', region: '', city: '' }),
      dev('5', 'o', true, { country: '海外', region: '', city: '' }),
      dev('6', 'x', false, null),
    ])
    expect(s.groups).toHaveLength(1)
    expect(s.groups[0]).toMatchObject({ label: '上海', total: 3, online: 2 })
    expect(s.groups[0]!.devices.map((d) => d.id)).toEqual(['2', '1', '3'])
    expect(s.local.total).toBe(1)
    expect(s.unlocated.total).toBe(2)
    expect(s.groupOf).toMatchObject({ '1': s.groups[0]!.key, '2': s.groups[0]!.key, '3': s.groups[0]!.key })
    expect(s.groupOf['4']).toBeUndefined()
  })

  it('takes the majority label, ties going to the first sorted device', () => {
    const en: GeoText = { country: 'China', region: 'Shanghai', city: 'Shanghai' }
    const s = summarizeLocations([dev('1', 'a', true, sh), dev('2', 'b', true, en), dev('3', 'c', true, en)])
    expect(s.groups).toHaveLength(1)
    expect(s.groups[0]!.label).toBe('Shanghai')
    const t = summarizeLocations([dev('1', 'a', true, sh), dev('2', 'b', true, en)])
    expect(t.groups[0]!.label).toBe('上海')
  })

  it('sorts groups by total, online then label', () => {
    const s = summarizeLocations([
      dev('1', 'a', true, { country: '中国', region: '北京', city: '北京' }),
      dev('2', 'b', true, sh),
      dev('3', 'c', true, sh),
      dev('4', 'd', true, { country: '日本', region: '', city: '东京' }),
    ])
    expect(s.groups.map((g) => g.label)).toEqual(['上海', '北京', '东京'])
  })

  it('flags country-only data', () => {
    const c: GeoText = { country: '中国', region: '', city: '' }
    expect(summarizeLocations([dev('1', 'a', true, c), dev('2', 'b', true, c)]).countryOnly).toBe(true)
    expect(summarizeLocations([dev('1', 'a', true, c), dev('2', 'b', true, sh)]).countryOnly).toBe(false)
    expect(summarizeLocations([]).countryOnly).toBe(false)
  })
})
