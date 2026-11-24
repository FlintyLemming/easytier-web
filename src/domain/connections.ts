import type { CentralNetworkMember, NodePeerInfo, NodeRouteInfo, TemporaryPeer } from '../api/types'
import { memberIp } from './devices'
import { ipv4FromU32 } from './format'

/** How an infrastructure node is labelled (spec §6.4): 「网关」 in Gateway networks, else 「服务器」. */
export type InfraLabel = 'gateway' | 'server'

/**
 * `via` is the next hop's resolved name; `viaKind` says what that hop is, so the UI can render
 * 「中继 · 经 网关/服务器」 for infrastructure hops (`viaInfra`, present only when `viaKind` is
 * `'infra'`). `'unknown'`: the hop is absent from the route table (`via` is then `#<peer id>`).
 */
export type LinkMode =
  | { type: 'p2p'; tunnel: string }
  | { type: 'relay'; via: string; viaKind: PeerLink['kind'] | 'unknown'; viaInfra?: InfraLabel }

export interface PeerLink {
  peerId: number
  name: string
  ip: string | null
  kind: 'member' | 'temporary' | 'infra'
  /** Present only when `kind === 'infra'`. */
  infra?: InfraLabel
  deviceId: string | null
  mode: LinkMode
  latencyMs: number | null
  rxBytes: number | null
  txBytes: number | null
}

/** `networking_method` of the network the links belong to → infra label. */
export function infraLabelFor(networkingMethod: string | null | undefined): InfraLabel {
  return networkingMethod === 'Gateway' ? 'gateway' : 'server'
}

function num(x: unknown): number | null {
  if (x === undefined || x === null || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function routeIp(r: NodeRouteInfo): string | null {
  const a = r.ipv4_addr?.address?.addr
  return typeof a === 'number' ? ipv4FromU32(a) : null
}

interface Identity {
  name: string
  ip: string | null
  kind: PeerLink['kind']
  infra?: InfraLabel
  deviceId: string | null
}

export function classifyPeers(i: {
  routes: NodeRouteInfo[]
  peers: NodePeerInfo[]
  members: CentralNetworkMember[]
  temporaryPeers: TemporaryPeer[]
  deviceNames: Record<string, string>
  /** Label for infrastructure nodes; default `'server'` (PublicServer / Manual networks). */
  infraLabel?: InfraLabel
}): PeerLink[] {
  const infraLabel = i.infraLabel ?? 'server'
  const memberByIp = new Map<string, CentralNetworkMember>()
  const memberByHost = new Map<string, CentralNetworkMember>()
  for (const m of i.members) {
    const ip = memberIp(m)
    if (ip && !memberByIp.has(ip)) memberByIp.set(ip, m)
    if (m.hostname && !memberByHost.has(m.hostname)) memberByHost.set(m.hostname, m)
  }
  const tempById = new Map<number, TemporaryPeer>()
  const tempByIp = new Map<string, TemporaryPeer>()
  for (const t of i.temporaryPeers) {
    tempById.set(t.peer_id, t)
    const ip = t.ipv4?.split('/')[0]
    if (ip) tempByIp.set(ip, t)
  }
  const peerById = new Map(i.peers.map(p => [p.peer_id, p]))

  const identify = (r: NodeRouteInfo): Identity => {
    const ip = routeIp(r)
    const m = (ip && memberByIp.get(ip)) || memberByHost.get(r.hostname)
    if (m) {
      return {
        name: i.deviceNames[m.device_id] || m.hostname || r.hostname,
        ip: ip ?? memberIp(m),
        kind: 'member',
        deviceId: m.device_id,
      }
    }
    const t = tempById.get(r.peer_id) ?? (ip ? tempByIp.get(ip) : undefined)
    if (t) {
      return { name: r.hostname, ip: ip ?? t.ipv4?.split('/')[0] ?? null, kind: 'temporary', deviceId: null }
    }
    return { name: r.hostname, ip, kind: 'infra', infra: infraLabel, deviceId: null }
  }

  const identities = new Map<number, Identity>()
  for (const r of i.routes) identities.set(r.peer_id, identify(r))

  return i.routes.map((r): PeerLink => {
    const id = identities.get(r.peer_id)!
    const open = (peerById.get(r.peer_id)?.conns ?? []).filter(c => !c.is_closed)
    let mode: LinkMode
    let latencyMs: number | null
    let rxBytes: number | null = null
    let txBytes: number | null = null
    if (open.length > 0) {
      mode = { type: 'p2p', tunnel: (open[0]!.tunnel?.tunnel_type ?? 'unknown').toLowerCase() }
      let minLat: number | null = null
      for (const c of open) {
        const lat = num(c.stats?.latency_us)
        if (lat !== null && (minLat === null || lat < minLat)) minLat = lat
        const rx = num(c.stats?.rx_bytes)
        if (rx !== null) rxBytes = (rxBytes ?? 0) + rx
        const tx = num(c.stats?.tx_bytes)
        if (tx !== null) txBytes = (txBytes ?? 0) + tx
      }
      latencyMs = minLat === null ? null : minLat / 1000
    } else {
      const hop = identities.get(r.next_hop_peer_id)
      mode = { type: 'relay', via: hop?.name ?? `#${r.next_hop_peer_id}`, viaKind: hop?.kind ?? 'unknown' }
      if (hop?.infra) mode.viaInfra = hop.infra
      latencyMs = num(r.path_latency) // already milliseconds
    }
    return { peerId: r.peer_id, ...id, mode, latencyMs, rxBytes, txBytes }
  })
}

/**
 * Two member devices of one network, merged from both ends' reports. The representative report is a
 * direct one when the pair is direct, else a relayed one, with the lowest non-null latency; ties (or no
 * latency at all) go to the lexicographically smaller reporter. `a` is that reporter, `b` its peer, and
 * `mode`/`latencyMs` come from that report.
 */
export interface DevicePair { networkId: string; a: string; b: string; direct: boolean; mode: LinkMode; latencyMs: number | null }

interface Report { reporter: string; peer: string; link: PeerLink }

function better(x: Report, y: Report): Report {
  const lx = x.link.latencyMs
  const ly = y.link.latencyMs
  if (lx !== null && (ly === null || lx < ly)) return x
  if (ly !== null && (lx === null || ly < lx)) return y
  return y.reporter < x.reporter ? y : x
}

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)

/**
 * Device pairs per network from each reporter's links (network id → reporting device id → links).
 * Only member links to another identified device count; infra and temporary nodes never form pairs.
 * Each unordered pair is counted once per network and is direct if either end reports p2p.
 */
export function buildPairs(linksByNetwork: Record<string, Record<string, PeerLink[]>>): DevicePair[] {
  const groups = new Map<string, { networkId: string; reports: Report[] }>()
  for (const [networkId, byDevice] of Object.entries(linksByNetwork)) {
    for (const [reporter, links] of Object.entries(byDevice)) {
      for (const link of links) {
        const peer = link.deviceId
        if (link.kind !== 'member' || !peer || peer === reporter) continue
        const key = JSON.stringify([networkId, ...[reporter, peer].sort()])
        let g = groups.get(key)
        if (!g) groups.set(key, (g = { networkId, reports: [] }))
        g.reports.push({ reporter, peer, link })
      }
    }
  }
  const pairs: DevicePair[] = []
  for (const { networkId, reports } of groups.values()) {
    const direct = reports.some((r) => r.link.mode.type === 'p2p')
    const rep = reports.filter((r) => (r.link.mode.type === 'p2p') === direct).reduce(better)
    pairs.push({ networkId, a: rep.reporter, b: rep.peer, direct, mode: rep.link.mode, latencyMs: rep.link.latencyMs })
  }
  return pairs.sort((x, y) => cmp(x.networkId, y.networkId) || cmp(x.a, y.a) || cmp(x.b, y.b))
}

export function summarizePairs(pairs: DevicePair[]): { direct: number; relayed: number; rate: number | null } {
  let direct = 0
  for (const p of pairs) if (p.direct) direct++
  return { direct, relayed: pairs.length - direct, rate: pairs.length === 0 ? null : direct / pairs.length }
}

/** Direct rate of one network's links (reporting device id → links). */
export function pairStats(linksByDevice: Record<string, PeerLink[]>): { direct: number; relayed: number; rate: number | null } {
  return summarizePairs(buildPairs({ '': linksByDevice }))
}
