import type { DeviceView } from '../devices'
import { locationText } from '../format'
import { resolvePlace, type PlaceLevel } from './resolve'

export interface LocationGroup {
  key: string; label: string; level: PlaceLevel; iso2: string; lon: number; lat: number
  /**
   * The distinct location texts of its devices (most devices first, then zh-CN): what the device list
   * filters on, so a link to this group lists every device it counts.
   */
  texts: string[]
  devices: DeviceView[]; online: number; total: number
}
export interface DeviceBucket { devices: DeviceView[]; online: number; total: number }
export interface LocationSummary {
  groups: LocationGroup[]
  local: DeviceBucket
  unlocated: DeviceBucket
  countryOnly: boolean
  /** Device id -> key of its group. */
  groupOf: Record<string, string>
}

const collator = new Intl.Collator('zh-CN')

function sortDevices(list: DeviceView[]): DeviceView[] {
  return [...list].sort((a, b) => Number(b.online) - Number(a.online) || collator.compare(a.name, b.name))
}

function bucket(list: DeviceView[]): DeviceBucket {
  const devices = sortDevices(list)
  return { devices, online: devices.filter((d) => d.online).length, total: devices.length }
}

interface RawGroup { key: string; level: PlaceLevel; iso2: string; lon: number; lat: number; list: DeviceView[] }

/** Location text -> device count, in the order of the (sorted) devices. */
function textCounts(key: string, sorted: DeviceView[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const d of sorted) {
    const t = locationText(d.knownLocation) ?? key
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return counts
}

/** The majority text; Map keeps insertion order = order of the sorted devices, so ties go to the first device's text. */
function majority(counts: Map<string, number>): string {
  const max = Math.max(...counts.values())
  return [...counts].find(([, n]) => n === max)![0]
}

export function summarizeLocations(devices: DeviceView[]): LocationSummary {
  const local: DeviceView[] = []
  const unlocated: DeviceView[] = []
  const byKey = new Map<string, RawGroup>()
  for (const d of devices) {
    const p = resolvePlace(d.knownLocation)
    if (p.kind === 'local') local.push(d)
    else if (p.kind === 'unlocated') unlocated.push(d)
    else {
      const g = byKey.get(p.key)
      if (g) g.list.push(d)
      else byKey.set(p.key, { key: p.key, level: p.level, iso2: p.iso2, lon: p.lon, lat: p.lat, list: [d] })
    }
  }

  const raw = [...byKey.values()].map((g) => {
    const sorted = sortDevices(g.list)
    return { ...g, list: sorted, label: majority(textCounts(g.key, sorted)) }
  })
  // A region named like a city of the same country (上海 the municipality vs 上海 the city) is the same
  // place to the user: fold it into that city group, which keeps its key, level and coordinates.
  const cities = raw.filter((g) => g.level === 'city').sort((a, b) => b.list.length - a.list.length)
  const merged = raw.filter((g) => {
    if (g.level !== 'region') return true
    const city = cities.find((c) => c.iso2 === g.iso2 && c.label === g.label)
    if (!city) return true
    city.list = sortDevices([...city.list, ...g.list])
    return false
  })

  const groups: LocationGroup[] = []
  const groupOf: Record<string, string> = {}
  let located = 0
  let withDetail = false
  for (const g of merged) {
    const texts = [...textCounts(g.key, g.list)]
      .sort(([a, x], [b, y]) => y - x || collator.compare(a, b))
      .map(([t]) => t)
    const online = g.list.filter((d) => d.online).length
    groups.push({
      key: g.key, label: g.label, level: g.level, iso2: g.iso2, lon: g.lon, lat: g.lat,
      texts, devices: g.list, online, total: g.list.length,
    })
    for (const d of g.list) {
      groupOf[d.id] = g.key
      located++
      if (d.knownLocation?.city || d.knownLocation?.region) withDetail = true
    }
  }
  groups.sort((a, b) => b.total - a.total || b.online - a.online || collator.compare(a.label, b.label))

  return {
    groups,
    local: bucket(local),
    unlocated: bucket(unlocated),
    countryOnly: located > 0 && !withDetail,
    groupOf,
  }
}
