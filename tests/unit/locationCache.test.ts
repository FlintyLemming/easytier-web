import { beforeEach, describe, expect, it } from 'vitest'
import type { RawMachine } from '../../src/api/types'
import {
  LOCATION_CACHE_MAX, LOCATION_CACHE_TTL_MS, LOCATION_REFRESH_MS, loadLocationCache, locationCacheKey,
  mergeLiveLocations, saveLocationCache, type LocationCache,
} from '../../src/lib/locationCache'

const ID1 = '11111111-1111-4111-8111-111111111111'
const NOW = 1_800_000_000_000
const HZ = { country: '中国', region: '浙江', city: '杭州' }
const idParts = { part1: 0x11111111, part2: 0x11114111, part3: 0x81111111, part4: 0x11111111 }

function machine(o: Partial<RawMachine> & { id?: boolean } = {}): RawMachine {
  const { id = true, ...rest } = o
  return { client_url: 'udp://1.1.1.1:1', info: id ? { machine_id: idParts } : {}, location: HZ, online: true, networks: [], ...rest } as unknown as RawMachine
}

beforeEach(() => localStorage.clear())

describe('load/save', () => {
  it('uses a per-user key', () => expect(locationCacheKey('admin')).toBe('et.locations.admin'))
  it('returns {} for missing, corrupt or malformed data', () => {
    expect(loadLocationCache('admin')).toEqual({})
    localStorage.setItem(locationCacheKey('admin'), '{not json')
    expect(loadLocationCache('admin')).toEqual({})
    localStorage.setItem(locationCacheKey('admin'), '[1,2]')
    expect(loadLocationCache('admin')).toEqual({})
    localStorage.setItem(locationCacheKey('admin'), JSON.stringify({ a: { geo: 1, at: 'x' } }))
    expect(loadLocationCache('admin')).toEqual({})
  })
  it('drops entries whose region or city is not text', () => {
    localStorage.setItem(locationCacheKey('admin'), JSON.stringify({
      cityNum: { geo: { country: '中国', city: 5 }, at: NOW },
      regionObj: { geo: { country: '中国', region: {}, city: '杭州' }, at: NOW },
      nulls: { geo: { country: '中国', region: null, city: null }, at: NOW },
      missing: { geo: { country: '中国' }, at: NOW },
      ok: { geo: HZ, at: NOW },
    }))
    expect(Object.keys(loadLocationCache('admin')).sort()).toEqual(['missing', 'nulls', 'ok'])
  })
  it('round-trips', () => {
    const c: LocationCache = { a: { geo: HZ, at: NOW } }
    saveLocationCache('admin', c)
    expect(loadLocationCache('admin')).toEqual(c)
  })
  it('swallows storage errors', () => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('quota') }
    try { expect(() => saveLocationCache('admin', {})).not.toThrow() } finally { Storage.prototype.setItem = orig }
    const origGet = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('denied') }
    try { expect(loadLocationCache('admin')).toEqual({}) } finally { Storage.prototype.getItem = origGet }
  })
})

describe('mergeLiveLocations', () => {
  it('adds online machines with an id and a location', () => {
    const r = mergeLiveLocations({}, [machine()], NOW)
    expect(r.changed).toBe(true)
    expect(r.cache[ID1]).toEqual({ geo: HZ, at: NOW })
  })
  it('skips offline, id-less and location-less machines', () => {
    const r = mergeLiveLocations({}, [machine({ online: false }), machine({ id: false }), machine({ location: null })], NOW)
    expect(r.changed).toBe(false)
    expect(r.cache).toEqual({})
  })
  it('does not change when unchanged and fresh; refreshes `at` after a day', () => {
    const cache: LocationCache = { [ID1]: { geo: HZ, at: NOW - 1000 } }
    expect(mergeLiveLocations(cache, [machine()], NOW).changed).toBe(false)
    const stale: LocationCache = { [ID1]: { geo: HZ, at: NOW - LOCATION_REFRESH_MS - 1 } }
    const r = mergeLiveLocations(stale, [machine()], NOW)
    expect(r.changed).toBe(true)
    expect(r.cache[ID1]!.at).toBe(NOW)
  })
  it('writes when the location changed', () => {
    const cache: LocationCache = { [ID1]: { geo: { ...HZ, city: '宁波' }, at: NOW - 1000 } }
    const r = mergeLiveLocations(cache, [machine()], NOW)
    expect(r.changed).toBe(true)
    expect(r.cache[ID1]!.geo.city).toBe('杭州')
  })
  it('drops entries past the TTL', () => {
    const cache: LocationCache = { old: { geo: HZ, at: NOW - LOCATION_CACHE_TTL_MS - 1 }, ok: { geo: HZ, at: NOW - 1 } }
    const r = mergeLiveLocations(cache, [], NOW)
    expect(r.changed).toBe(true)
    expect(Object.keys(r.cache)).toEqual(['ok'])
  })
  it('keeps only the newest 1000 entries', () => {
    const cache: LocationCache = {}
    for (let i = 0; i <= LOCATION_CACHE_MAX; i++) cache[`k${i}`] = { geo: HZ, at: NOW - 10_000 + i }
    const r = mergeLiveLocations(cache, [], NOW)
    expect(Object.keys(r.cache)).toHaveLength(LOCATION_CACHE_MAX)
    expect(r.cache.k0).toBeUndefined()
    expect(r.cache.k1).toBeDefined()
    expect(r.changed).toBe(true)
  })
  it('does not mutate its input', () => {
    const cache: LocationCache = { old: { geo: HZ, at: NOW - LOCATION_CACHE_TTL_MS - 1 } }
    const snap = JSON.parse(JSON.stringify(cache))
    mergeLiveLocations(cache, [machine()], NOW)
    expect(cache).toEqual(snap)
  })
})
