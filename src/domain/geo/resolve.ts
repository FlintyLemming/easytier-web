import type { GeoText } from '../../api/types'
import places from '../../generated/geo/places.json'
import { nameKeys, normalizeName } from './normalize'

export type PlaceLevel = 'city' | 'region' | 'country'
export type ResolvedPlace =
  | { kind: 'local' }
  | { kind: 'unlocated' }
  | { kind: 'place'; key: string; level: PlaceLevel; iso2: string; lon: number; lat: number }

interface Row {
  idx: number
  iso2: string
  lon: number
  lat: number
  keys: string[]
  pop: number
}
interface Index {
  countries: Map<string, Row>
  countryByKey: Map<string, string>
  regions: Map<string, Row[]>
  cities: Map<string, Row[]>
}

let cache: Index | null = null

function build(): Index {
  const countries = new Map<string, Row>()
  const countryByKey = new Map<string, string>()
  const regions = new Map<string, Row[]>()
  const cities = new Map<string, Row[]>()
  const data = places as unknown as {
    countries: [string, number, number, string][]
    regions: [string, number, number, string][]
    cities: [string, number, number, string, number][]
  }
  data.countries.forEach(([iso2, lon, lat, keys], idx) => {
    const row: Row = { idx, iso2, lon, lat, keys: keys.split('|'), pop: 0 }
    countries.set(iso2, row)
    for (const k of row.keys) if (!countryByKey.has(k)) countryByKey.set(k, iso2)
  })
  const add = (map: Map<string, Row[]>, row: Row) => {
    const list = map.get(row.iso2)
    if (list) list.push(row)
    else map.set(row.iso2, [row])
  }
  data.regions.forEach(([iso2, lon, lat, keys], idx) =>
    add(regions, { idx, iso2, lon, lat, keys: keys.split('|'), pop: 0 }),
  )
  data.cities.forEach(([iso2, lon, lat, keys, pop], idx) =>
    add(cities, { idx, iso2, lon, lat, keys: keys.split('|'), pop }),
  )
  return { countries, countryByKey, regions, cities }
}

function biggest(rows: Row[]): Row {
  return rows.reduce((a, b) => (b.pop > a.pop ? b : a))
}

const UNLOCATED: ResolvedPlace = { kind: 'unlocated' }
const LOCAL_KEY = normalizeName('本地网络')
const OVERSEAS_KEY = normalizeName('海外')

function place(level: PlaceLevel, prefix: string, row: Row): ResolvedPlace {
  const key = level === 'country' ? `country:${row.iso2}` : `${prefix}:${row.iso2}:${row.idx}`
  return { kind: 'place', key, level, iso2: row.iso2, lon: row.lon, lat: row.lat }
}

export function resolvePlace(geo: GeoText | null | undefined): ResolvedPlace {
  try {
    if (!geo || typeof geo.country !== 'string') return UNLOCATED
    const countryNorm = normalizeName(geo.country)
    if (countryNorm === LOCAL_KEY) return { kind: 'local' }
    if (!countryNorm || countryNorm === OVERSEAS_KEY) return UNLOCATED

    const idx = (cache ??= build())
    let iso2: string | undefined
    for (const k of nameKeys(geo.country)) {
      iso2 = idx.countryByKey.get(k)
      if (iso2) break
    }
    if (!iso2) return UNLOCATED
    const country = idx.countries.get(iso2)!

    const city = typeof geo.city === 'string' ? geo.city.trim() : ''
    const cityRows = idx.cities.get(iso2)
    if (city && cityRows) {
      const cKeys = nameKeys(city).filter(Boolean)
      const exact = cityRows.filter((r) => r.keys.some((k) => cKeys.includes(k)))
      if (exact.length) return place('city', 'city', biggest(exact))
      if (/\p{Script=Han}/u.test(city)) {
        const suffix = cityRows.filter((r) =>
          r.keys.some((k) => cKeys.some((c) => k.endsWith(c))),
        )
        if (suffix.length) return place('city', 'city', biggest(suffix))
      }
    }

    const regionRows = idx.regions.get(iso2)
    if (typeof geo.region === 'string' && regionRows) {
      for (const part of geo.region.split(',')) {
        if (!part.trim()) continue
        const rKeys = nameKeys(part)
        const hit = regionRows.find((r) => r.keys.some((k) => rKeys.includes(k)))
        if (hit) return place('region', 'region', hit)
      }
    }

    return place('country', 'country', country)
  } catch {
    return UNLOCATED
  }
}
