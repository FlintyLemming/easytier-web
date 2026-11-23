import type { CentralNetworkMember, CentralNetworkSummary, GeoText, RawMachine } from '../api/types'
import { osLabel, publicIpFromClientUrl } from './format'
import { uuidToStr } from '../lib/uuid'
import { isOutdated, latestVersion } from './version'

export interface DeviceView {
  id: string; name: string; hostname: string; alias: string | null; os: string
  online: boolean; lastSeen: string | null; version: string; outdated: boolean
  publicIp: string | null; location: GeoText | null
  networks: { id: string; name: string }[]
  defaultNetworkId: string | null
  member: CentralNetworkMember | null
  ip: string | null
}

/** First network with the highest member count. */
export function primaryNetworkId(networks: CentralNetworkSummary[]): string | null {
  let best: CentralNetworkSummary | null = null
  for (const n of networks) {
    if (!best || n.member_count > best.member_count) best = n
  }
  return best ? best.network_id : null
}

export function defaultNetworkId(deviceNetworkIds: string[], primaryId: string | null): string | null {
  if (primaryId !== null && deviceNetworkIds.includes(primaryId)) return primaryId
  return deviceNetworkIds[0] ?? null
}

export function memberIp(m: CentralNetworkMember): string | null {
  const raw = m.runtime_virtual_ipv4 || m.virtual_ipv4 || m.allocated_ipv4
  return raw ? raw.split('/')[0]! : null
}

export function buildDeviceViews(
  machines: RawMachine[],
  networks: CentralNetworkSummary[],
  membersByNetwork: Record<string, CentralNetworkMember[]>,
): DeviceView[] {
  const primary = primaryNetworkId(networks)
  const latest = latestVersion(machines.map((m) => m.info?.easytier_version ?? ''))
  return machines.map((m) => {
    const id = uuidToStr(m.info?.machine_id)
    const hostname = m.info?.hostname ?? ''
    const alias = m.alias ? m.alias : null
    const nets = (m.networks ?? []).map((n) => ({ id: n.network_id, name: n.display_name }))
    const defId = defaultNetworkId(nets.map((n) => n.id), primary)
    const member = defId ? (membersByNetwork[defId] ?? []).find((x) => x.device_id === id) ?? null : null
    const version = m.info?.easytier_version ?? ''
    return {
      id,
      name: alias || hostname || id,
      hostname,
      alias,
      os: osLabel(m.info?.device_os),
      online: m.online ?? false,
      lastSeen: m.last_seen ?? null,
      version,
      outdated: isOutdated(version, latest),
      publicIp: publicIpFromClientUrl(m.client_url),
      location: m.location ?? null,
      networks: nets,
      defaultNetworkId: defId,
      member,
      ip: member ? memberIp(member) : null,
    }
  })
}
