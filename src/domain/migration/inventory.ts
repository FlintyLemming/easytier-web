import type { CentralNetworkSummary, NetworkingMethod, RawMachine } from '../../api/types'
import { uuidToStr } from '../../lib/uuid'
import { isIpv4 } from '../cidr'
import type { DeviceRef, DraftConflicts, LegacyConfig, LegacyGroup, LegacyInstance, NetworkDraft, ValueCount } from './types'

export function isLegacyId(id: string, networks: CentralNetworkSummary[]): boolean {
  return !networks.some((n) => n.network_id === id)
}

/**
 * Legacy instance ids the online devices report running in their heartbeats (sorted, unique).
 * Costs no request: the overview banner reads them from the inventory's `/machines`.
 */
export function runningLegacyIds(machines: RawMachine[], networks: CentralNetworkSummary[]): string[] {
  const out = new Set<string>()
  for (const m of machines) {
    if (!m.online) continue
    for (const u of m.info?.running_network_instances ?? []) {
      const id = uuidToStr(u)
      if (isLegacyId(id, networks)) out.add(id)
    }
  }
  return [...out].sort()
}

const byName = (devices: Map<string, DeviceRef>) => (a: LegacyInstance, b: LegacyInstance) => {
  const na = devices.get(a.deviceId)?.name ?? a.deviceId
  const nb = devices.get(b.deviceId)?.name ?? b.deviceId
  return na.localeCompare(nb) || a.instanceId.localeCompare(b.instanceId)
}

export function groupLegacy(
  instances: LegacyInstance[],
  devices: Map<string, DeviceRef>,
  networks: CentralNetworkSummary[],
): LegacyGroup[] {
  const byNet = new Map<string, LegacyInstance[]>()
  for (const i of instances) {
    const list = byNet.get(i.networkName) ?? []
    list.push(i)
    byNet.set(i.networkName, list)
  }
  return [...byNet.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([networkName, list]) => {
      const sorted = [...list].sort(byName(devices))
      const runningCount = sorted.filter((i) => i.running).length
      return {
        networkName,
        instances: sorted,
        runningCount,
        disabledCount: sorted.length - runningCount,
        targetNetworkId: networks.find((n) => n.network_name === networkName)?.network_id ?? null,
      }
    })
}

/** `networking_method` as its proto enum name (pbjson accepts the number or the name). */
export function methodName(raw: unknown): 'PublicServer' | 'Manual' | 'Standalone' | null {
  if (raw === 0 || raw === 'PublicServer') return 'PublicServer'
  if (raw === 1 || raw === 'Manual') return 'Manual'
  if (raw === 2 || raw === 'Standalone') return 'Standalone'
  return null
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])

/**
 * The addresses a config actually connects to (sorted, unique). PublicServer and Manual compile to
 * the same `[[peer]]` entries, and a 2.6.4 core reads PublicServer back as Manual, so connectivity
 * is compared by these addresses rather than by the method's name.
 */
export function effectivePeers(config: LegacyConfig): string[] {
  const method = methodName(config.networking_method)
  if (method === 'Standalone') return []
  if (method === 'PublicServer') {
    const url = typeof config.public_server_url === 'string' ? config.public_server_url : ''
    return url ? [url] : []
  }
  const peers = Array.isArray(config.peers)
    ? config.peers.map((p) => (p && typeof p === 'object' ? (p as { uri?: unknown }).uri : undefined))
    : []
  return [...new Set([...strings(config.peer_urls), ...strings(peers)])].sort()
}

const toU32 = (ip: string) => ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0)
const fromU32 = (a: number) => [24, 16, 8, 0].map((s) => (a >>> s) & 255).join('.')

/** Fixed IP without its prefix, or null when the config uses DHCP or has none. */
export function fixedIp(config: LegacyConfig): string | null {
  if (config.dhcp === true) return null
  const raw = typeof config.virtual_ipv4 === 'string' ? config.virtual_ipv4.split('/')[0]!.trim() : ''
  return raw && isIpv4(raw) ? raw : null
}

/** `network_length`, 24 when unset (the core's default). */
export function networkLength(config: LegacyConfig): number {
  const n = Number(config.network_length)
  return Number.isInteger(n) && n >= 0 && n <= 32 && config.network_length != null ? n : 24
}

/** The subnet of the config's fixed IP, `a.b.c.d/len`; null without a fixed IP. */
export function subnetOf(config: LegacyConfig): string | null {
  const ip = fixedIp(config)
  if (!ip) return null
  const len = networkLength(config)
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0
  return `${fromU32((toU32(ip) & mask) >>> 0)}/${len}`
}

/** Counts in first-seen order, then sorted by count (stable, so ties keep first-seen order). */
function tally(values: (string | null)[]): ValueCount[] {
  const counts = new Map<string, number>()
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
}

const conflictsOf = (t: ValueCount[]) => (t.length > 1 ? t : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Spec §5.10.2 step 2: a central network draft from the group's most common values. */
export function draftFromGroup(group: LegacyGroup): { draft: NetworkDraft; conflicts: DraftConflicts; serverUnion: string[] } {
  const running = group.instances.filter((i) => i.running)
  const counted = (running.length ? running : group.instances).map((i) => i.config)

  const names = tally(counted.map((c) => str(c.network_name)))
  const secrets = tally(counted.map((c) => str(c.network_secret)))
  const connectivity = tally(counted.map((c) => effectivePeers(c).join(', ')))
  const subnets = tally(counted.map((c) => subnetOf(c)))

  const topPeers = connectivity[0]?.value ?? ''
  const peers = topPeers ? topPeers.split(', ') : []
  let method: NetworkingMethod = 'Manual'
  if (peers.length === 0) method = 'Standalone'
  else if (
    peers.length === 1 &&
    counted.filter((c) => effectivePeers(c).join(', ') === topPeers).every((c) => methodName(c.networking_method) === 'PublicServer')
  ) {
    method = 'PublicServer'
  }

  const networkName = names[0]?.value ?? group.networkName
  return {
    draft: {
      form: {
        displayName: networkName || group.networkName,
        networkName: networkName || group.networkName,
        method,
        publicServerUrl: method === 'PublicServer' ? peers[0]! : '',
        peerUrls: method === 'Manual' ? peers : [],
        virtualCidr: subnets[0]?.value ?? '',
        secureMode: false,
      },
      secret: secrets[0]?.value ?? '',
    },
    conflicts: {
      networkName: conflictsOf(names),
      secret: conflictsOf(secrets),
      connectivity: conflictsOf(connectivity),
      subnet: conflictsOf(subnets),
    },
    serverUnion: [...new Set(group.instances.flatMap((i) => effectivePeers(i.config)))].sort(),
  }
}
