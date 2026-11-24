import type { DeviceView } from '../devices'
import { locationText } from '../format'
import { resolvePlace, type PlaceLevel } from './resolve'

export interface LocationGroup {
  key: string; label: string; level: PlaceLevel; lon: number; lat: number
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

export function summarizeLocations(devices: DeviceView[]): LocationSummary {
  const local: DeviceView[] = []
  const unlocated: DeviceView[] = []
  const byKey = new Map<string, { level: PlaceLevel; lon: number; lat: number; list: DeviceView[] }>()
  for (const d of devices) {
    const p = resolvePlace(d.knownLocation)
    if (p.kind === 'local') local.push(d)
    else if (p.kind === 'unlocated') unlocated.push(d)
    else {
      const g = byKey.get(p.key)
      if (g) g.list.push(d)
      else byKey.set(p.key, { level: p.level, lon: p.lon, lat: p.lat, list: [d] })
    }
  }

  const groups: LocationGroup[] = []
  const groupOf: Record<string, string> = {}
  let located = 0
  let withDetail = false
  for (const [key, g] of byKey) {
    const sorted = sortDevices(g.list)
    const counts = new Map<string, number>()
    for (const d of sorted) {
      const t = locationText(d.knownLocation) ?? key
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const max = Math.max(...counts.values())
    // Map keeps insertion order = order of the sorted devices, so ties go to the first device's text.
    const label = [...counts].find(([, n]) => n === max)![0]
    const online = sorted.filter((d) => d.online).length
    groups.push({ key, label, level: g.level, lon: g.lon, lat: g.lat, devices: sorted, online, total: sorted.length })
    for (const d of sorted) {
      groupOf[d.id] = key
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
