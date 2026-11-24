import { geoDistance } from 'd3-geo'
import type { LocationGroup } from './groups'

export const FOCUS_RADIUS_KM = 3000
export const FOCUS_MIN_SHARE = 0.6
export const FOCUS_MIN_SPAN = { lon: 20, lat: 12 }
export const MAP_LAT_RANGE: readonly [number, number] = [-56, 78]

/** dLon is relative to centerLon, in [-180, 180]. */
export interface FocusBox { dLonMin: number; dLonMax: number; latMin: number; latMax: number }
export interface MapFocus { centerLon: number; box: FocusBox | null }

type G = Pick<LocationGroup, 'lon' | 'lat' | 'total'>

const RAD = Math.PI / 180
const EARTH_KM = 6371

function wrap(dLon: number): number {
  return ((((dLon + 180) % 360) + 360) % 360) - 180
}

export function computeFocus(groups: G[]): MapFocus {
  if (groups.length === 0) return { centerLon: 0, box: null }
  const sum = groups.reduce((s, g) => s + g.total, 0)
  let sx = 0
  let sy = 0
  let lat = 0
  for (const g of groups) {
    sx += g.total * Math.cos(g.lon * RAD)
    sy += g.total * Math.sin(g.lon * RAD)
    lat += g.total * g.lat
  }
  const meanLon = Math.atan2(sy, sx) / RAD
  const centerLon = Math.round(meanLon / 5) * 5 || 0

  const coreAround = (c: [number, number]) =>
    groups.filter((g) => geoDistance(c, [g.lon, g.lat]) * EARTH_KM <= FOCUS_RADIUS_KM)
  const share = (core: G[]) => core.reduce((s, g) => s + g.total, 0) / sum

  let core = coreAround([meanLon, lat / sum])
  if (share(core) < FOCUS_MIN_SHARE) {
    const top = groups.reduce((b, g) => (g.total > b.total ? g : b))
    core = coreAround([top.lon, top.lat])
    if (share(core) < FOCUS_MIN_SHARE) return { centerLon, box: null }
  }

  const dLons = core.map((g) => wrap(g.lon - centerLon))
  const lats = core.map((g) => g.lat)
  let dLonMin = Math.min(...dLons)
  let dLonMax = Math.max(...dLons)
  let latMin = Math.min(...lats)
  let latMax = Math.max(...lats)
  if (dLonMax - dLonMin >= 200) return { centerLon, box: null }
  if (dLonMax - dLonMin < FOCUS_MIN_SPAN.lon) {
    const mid = (dLonMin + dLonMax) / 2
    dLonMin = mid - FOCUS_MIN_SPAN.lon / 2
    dLonMax = mid + FOCUS_MIN_SPAN.lon / 2
  }
  if (latMax - latMin < FOCUS_MIN_SPAN.lat) {
    const mid = (latMin + latMax) / 2
    latMin = mid - FOCUS_MIN_SPAN.lat / 2
    latMax = mid + FOCUS_MIN_SPAN.lat / 2
  }
  latMin = Math.max(latMin, MAP_LAT_RANGE[0])
  latMax = Math.min(latMax, MAP_LAT_RANGE[1])
  return { centerLon, box: { dLonMin, dLonMax, latMin, latMax } }
}
