import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { nameKeys, normalizeName } from '../../src/domain/geo/normalize'
import { isLand } from '../../src/domain/geo/landMask'
import places from '../../src/generated/geo/places.json'

describe('normalizeName', () => {
  it('folds case, accents, spaces and punctuation', () => {
    expect(normalizeName('São Paulo')).toBe('saopaulo')
    expect(normalizeName('Frankfurt am Main')).toBe('frankfurtammain')
    expect(normalizeName(' 上海 ')).toBe('上海')
  })
})

describe('nameKeys', () => {
  it('strips one administrative suffix from Chinese names', () => {
    expect(nameKeys('上海市')).toContain('上海')
    expect(nameKeys('新疆维吾尔自治区')).toContain('新疆')
    expect(nameKeys('东京都')).toContain('东京')
  })
  it('does not strip 州', () => {
    expect(nameKeys('杭州')).toStrictEqual(['杭州'])
  })
})

describe('isLand', () => {
  it('is true on land, with longitude wrapping', () => {
    expect(isLand(121.47, 31.23)).toBe(true)
    expect(isLand(116.4, 39.9)).toBe(true)
    expect(isLand(10, 50)).toBe(true)
    expect(isLand(121.47 + 360, 31.23)).toBe(true)
  })
  it('is false at sea', () => {
    expect(isLand(-150, 0)).toBe(false)
    expect(isLand(0, 0)).toBe(false)
  })
})

describe('places.json', () => {
  it('stays within the size budget', () => {
    const raw = readFileSync(resolve(__dirname, '../../src/generated/geo/places.json'))
    expect(gzipSync(raw).length).toBeLessThanOrEqual(150 * 1024)
    expect(places.cities.length).toBeGreaterThanOrEqual(3000)
  })
  it('knows major cities, countries and regions by Chinese name', () => {
    const has = (rows: (string | number)[][], iso: string, key: string) =>
      rows.some((r) => r[0] === iso && String(r[3]).split('|').includes(key))
    expect(has(places.cities, 'CN', '上海')).toBe(true)
    expect(has(places.cities, 'US', '洛杉矶')).toBe(true)
    expect(has(places.countries, 'CN', '中国')).toBe(true)
    expect(has(places.regions, 'CN', '广东')).toBe(true)
  })
})
