import type { DeviceView } from './devices'
import { locationText } from './format'

export type StatusFilter = 'all' | 'online' | 'offline' | 'unjoined'
export type SortKey = 'name' | 'ip' | 'version' | 'lastSeen'
export type SortDir = 'asc' | 'desc'

const ZH = 'zh-CN'

export function filterDevices(
  ds: DeviceView[],
  f: { query: string; status: StatusFilter; city?: string | string[] | null },
): DeviceView[] {
  const cities = f.city ? (Array.isArray(f.city) ? f.city : [f.city]).filter(Boolean) : []
  const q = f.query.trim().toLowerCase()
  return ds.filter((d) => {
    if (f.status === 'online' && !d.online) return false
    if (f.status === 'offline' && d.online) return false
    if (f.status === 'unjoined' && d.defaultNetworkId !== null) return false
    if (cities.length && !cities.includes(locationText(d.knownLocation) ?? '')) return false
    if (!q) return true
    return [d.name, d.hostname, d.ip, d.publicIp, locationText(d.knownLocation)].some(
      (s) => !!s && s.toLowerCase().includes(q),
    )
  })
}

function ipKey(ip: string): number[] {
  return ip.split('.').map((x) => Number(x) || 0)
}

function compareIp(a: string, b: string): number {
  const x = ipKey(a)
  const y = ipKey(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return a.localeCompare(b)
}

function compareVersion(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

function lastSeenValue(d: DeviceView): number | null {
  if (d.online) return Number.MAX_SAFE_INTEGER
  if (!d.lastSeen) return null
  const t = Date.parse(d.lastSeen)
  return Number.isNaN(t) ? null : t
}

/** Without a key: online first, then name (zh-CN). With a key: missing values always last. */
export function sortDevices(ds: DeviceView[], key?: SortKey, dir: SortDir = 'asc'): DeviceView[] {
  const out = [...ds]
  if (!key) {
    return out.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, ZH))
  }
  const sign = dir === 'asc' ? 1 : -1
  const value = (d: DeviceView): string | number | null => {
    switch (key) {
      case 'name': return d.name
      case 'ip': return d.ip
      case 'version': return d.version || null
      case 'lastSeen': return lastSeenValue(d)
    }
  }
  return out.sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === null && y === null) return a.name.localeCompare(b.name, ZH)
    if (x === null) return 1
    if (y === null) return -1
    let c: number
    if (key === 'name') c = (x as string).localeCompare(y as string, ZH)
    else if (key === 'ip') c = compareIp(x as string, y as string)
    else if (key === 'version') c = compareVersion(x as string, y as string)
    else c = (x as number) - (y as number)
    return c * sign || a.name.localeCompare(b.name, ZH)
  })
}

export function statusCounts(ds: DeviceView[]): Record<StatusFilter, number> {
  return {
    all: ds.length,
    online: ds.filter((d) => d.online).length,
    offline: ds.filter((d) => !d.online).length,
    unjoined: ds.filter((d) => d.defaultNetworkId === null).length,
  }
}
