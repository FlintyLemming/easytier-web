import { describe, expect, it } from 'vitest'
import { resolvePlace } from '../../src/domain/geo/resolve'

function expectNear(r: ReturnType<typeof resolvePlace>, lon: number, tol = 0.5, lat?: number) {
  if (r.kind !== 'place') throw new Error('not a place: ' + JSON.stringify(r))
  expect(Math.abs(r.lon - lon)).toBeLessThanOrEqual(tol)
  if (lat !== undefined) expect(Math.abs(r.lat - lat)).toBeLessThanOrEqual(tol)
}

describe('resolvePlace', () => {
  it('city match: Shanghai', () => {
    const r = resolvePlace({ country: '中国', region: '上海', city: '上海' })
    expect(r).toMatchObject({ kind: 'place', level: 'city', iso2: 'CN' })
    expectNear(r, 121.4, 0.5, 31.2)
  })
  it('city match: Shenzhen', () => {
    const r = resolvePlace({ country: '中国', region: '广东', city: '深圳' })
    expect(r).toMatchObject({ kind: 'place', level: 'city' })
    expectNear(r, 114.1)
  })
  it('country only', () => {
    const r = resolvePlace({ country: '中国' })
    expect(r).toMatchObject({ kind: 'place', level: 'country', iso2: 'CN', key: 'country:CN' })
    if (r.kind === 'place') {
      expect(r.lon).toBeGreaterThan(100)
      expect(r.lon).toBeLessThan(110)
    }
  })
  it('region with suffix', () => {
    const r = resolvePlace({ country: '中国', region: '广东省' })
    expect(r).toMatchObject({ kind: 'place', level: 'region', iso2: 'CN' })
    expectNear(r, 113.7)
  })
  it('unknown city falls back to region', () => {
    expect(resolvePlace({ country: '中国', region: '浙江', city: '台州' })).toMatchObject({
      kind: 'place',
      level: 'region',
      iso2: 'CN',
    })
  })
  it('Los Angeles is the US one', () => {
    const r = resolvePlace({ country: '美国', region: '加利福尼亚州', city: '洛杉矶' })
    expect(r).toMatchObject({ kind: 'place', level: 'city', iso2: 'US' })
    expectNear(r, -118.2)
  })
  it('Frankfurt am Main via suffix match', () => {
    const r = resolvePlace({ country: '德国', region: '黑森', city: '法兰克福' })
    expect(r).toMatchObject({ kind: 'place', level: 'city', iso2: 'DE' })
    expectNear(r, 8.7, 0.3)
  })
  it('English names; unknown city falls back to region', () => {
    const r = resolvePlace({ country: 'United States', region: 'Virginia', city: 'Ashburn' })
    expect(r).toMatchObject({ kind: 'place', level: 'region', iso2: 'US' })
    expectNear(r, -78.2, 1.5)
  })
  it('comma separated region', () => {
    expect(resolvePlace({ country: '英国', region: '英格兰,大伦敦', city: '伦敦' })).toMatchObject({
      kind: 'place',
      level: 'city',
      iso2: 'GB',
    })
  })
  it('Tokyo', () => {
    expect(resolvePlace({ country: '日本', region: '东京都', city: '东京' })).toMatchObject({
      kind: 'place',
      level: 'city',
      iso2: 'JP',
    })
  })
  it('Hong Kong', () => {
    expect(resolvePlace({ country: '香港', city: '香港' })).toMatchObject({
      kind: 'place',
      iso2: 'HK',
    })
  })
  it('local network', () => {
    expect(resolvePlace({ country: '本地网络', city: null, region: null })).toEqual({ kind: 'local' })
  })
  it('unlocated', () => {
    expect(resolvePlace({ country: '海外' })).toEqual({ kind: 'unlocated' })
    expect(resolvePlace({ country: '' })).toEqual({ kind: 'unlocated' })
    expect(resolvePlace(null)).toEqual({ kind: 'unlocated' })
    expect(resolvePlace(undefined)).toEqual({ kind: 'unlocated' })
    expect(resolvePlace({ country: '火星', city: '奥林匹斯' })).toEqual({ kind: 'unlocated' })
  })
  it('keys are stable', () => {
    const g = { country: '中国', region: '广东', city: '深圳' }
    expect(resolvePlace(g)).toEqual(resolvePlace(g))
    expect((resolvePlace(g) as { key: string }).key).toMatch(/^city:CN:\d+$/)
  })
})
