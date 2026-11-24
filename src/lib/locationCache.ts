import type { GeoText, RawMachine } from '../api/types'
import { uuidToStr } from './uuid'

export interface CachedLocation { geo: GeoText; at: number }
/** Keyed by machine id. */
export type LocationCache = Record<string, CachedLocation>

export const LOCATION_CACHE_MAX = 1000
export const LOCATION_CACHE_TTL_MS = 180 * 86_400_000
export const LOCATION_REFRESH_MS = 86_400_000

export function locationCacheKey(username: string): string {
  return `et.locations.${username}`
}

const optionalText = (v: unknown) => v === undefined || v === null || typeof v === 'string'

function validEntry(v: unknown): v is CachedLocation {
  if (!v || typeof v !== 'object') return false
  const e = v as { geo?: unknown; at?: unknown }
  if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return false
  if (!e.geo || typeof e.geo !== 'object') return false
  const g = e.geo as { country?: unknown; region?: unknown; city?: unknown }
  return typeof g.country === 'string' && optionalText(g.region) && optionalText(g.city)
}

/** Never throws: anything missing, corrupt or unreadable yields `{}`. */
export function loadLocationCache(username: string): LocationCache {
  try {
    const raw = localStorage.getItem(locationCacheKey(username))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: LocationCache = {}
    for (const [k, v] of Object.entries(parsed)) if (validEntry(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Never throws (e.g. storage quota exceeded). */
export function saveLocationCache(username: string, cache: LocationCache): void {
  try {
    localStorage.setItem(locationCacheKey(username), JSON.stringify(cache))
  } catch {
    // ignore
  }
}

const norm = (s: string | null | undefined) => s || null
function sameGeo(a: GeoText, b: GeoText): boolean {
  return norm(a.country) === norm(b.country) && norm(a.region) === norm(b.region) && norm(a.city) === norm(b.city)
}

/** Pure: returns a new cache; `cache` is not modified. */
export function mergeLiveLocations(
  cache: LocationCache,
  machines: RawMachine[],
  now: number,
): { cache: LocationCache; changed: boolean } {
  const next: LocationCache = { ...cache }
  let changed = false
  for (const m of machines) {
    if (m.online !== true || !m.location) continue
    const id = uuidToStr(m.info?.machine_id)
    if (!id) continue
    const prev = next[id]
    if (!prev || !sameGeo(prev.geo, m.location) || prev.at < now - LOCATION_REFRESH_MS) {
      next[id] = { geo: { country: m.location.country, region: m.location.region ?? null, city: m.location.city ?? null }, at: now }
      changed = true
    }
  }
  for (const [k, v] of Object.entries(next)) {
    if (v.at < now - LOCATION_CACHE_TTL_MS) { delete next[k]; changed = true }
  }
  const keys = Object.keys(next)
  if (keys.length > LOCATION_CACHE_MAX) {
    keys.sort((a, b) => next[b]!.at - next[a]!.at)
    for (const k of keys.slice(LOCATION_CACHE_MAX)) delete next[k]
    changed = true
  }
  return { cache: next, changed }
}
