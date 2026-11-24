import type { CentralNetworkSummary } from '../api/types'
import type { DeviceView } from './devices'
import { latestVersion, parseVersion } from './version'

export interface OverviewStats {
  total: number
  online: number
  offline: number
  networks: number
  primary: { name: string; cidr: string | null } | null
  outdated: number
  /** Highest `x.y.z` among all devices; null when none parses. */
  latest: string | null
}

export function overviewStats(
  devices: DeviceView[],
  networks: CentralNetworkSummary[],
  primary: CentralNetworkSummary | null,
): OverviewStats {
  const online = devices.filter((d) => d.online).length
  const best = latestVersion(devices.map((d) => d.version))
  return {
    total: devices.length,
    online,
    offline: devices.length - online,
    networks: networks.length,
    primary: primary ? { name: primary.display_name, cidr: primary.virtual_cidr || null } : null,
    outdated: devices.filter((d) => d.outdated).length,
    latest: best ? (parseVersion(best)!.join('.')) : null,
  }
}
