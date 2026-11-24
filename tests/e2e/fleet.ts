/**
 * Reusable 20-device e2e dataset (overview, map and connection tests share it).
 *
 * One central network "家庭网" (`home`, 10.144.0.0/24). Device NN has machine id
 * `00000000-0000-4000-8000-0000000000NN` and member IP 10.144.0.NN (sh-pi, number 06, is not a member).
 * Everything derives from `now`, so a given `now` always yields the same data.
 *
 * Expected totals: 20 devices, 18 online (old-laptop and fra-backup offline for 3 weeks + 1 h and 2 days
 * + 1 h); 17 online members -> 136 pairs, 3 relayed (la-vps<->bj-dev and la-vps<->sh-dev via hk-vps,
 * tokyo-relay<->bj-vps via the infra node public-server), 133 direct -> 98%; 3 outdated (office-pc and
 * fra-backup 2.6.4, old-laptop 2.5.0), latest 2.7.1; one blocked device `unknown-pc`.
 * proxy-rpc answers `list_route` / `list_peer` for online members only.
 */
import type { Request } from '@playwright/test'
import { strToUuid } from '../../src/lib/uuid'
import type { LocationCache } from '../../src/lib/locationCache'
import type { Overrides } from './mockApi'

const NETWORK_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

interface Place { country: string; region: string | null; city: string | null }
const SH: Place = { country: '中国', region: '上海', city: '上海' }
const NJ: Place = { country: '中国', region: '江苏', city: '南京' }
const BJ: Place = { country: '中国', region: '北京', city: '北京' }
const HK: Place = { country: '香港', region: null, city: '香港' }
const SZ: Place = { country: '中国', region: '广东', city: '深圳' }
const TKY: Place = { country: '日本', region: '东京都', city: '东京' }
const LA: Place = { country: '美国', region: '加利福尼亚州', city: '洛杉矶' }
const LAN: Place = { country: '本地网络', region: null, city: null }

interface Row {
  name: string
  /** Live location; undefined for the offline devices (no location). */
  place?: Place
  version?: string
  /** Offline for this long. */
  offlineMs?: number
  /** Not a member of the network (not yet joined). */
  unjoined?: boolean
}

/** Index + 1 is the device number NN. */
const ROWS: Row[] = [
  { name: 'router-ax6000', place: SH },
  { name: 'home-nas', place: SH },
  { name: 'macbook-pro', place: SH },
  { name: 'office-pc', place: SH, version: '2.6.4' },
  { name: 'sh-dev', place: SH },
  { name: 'sh-pi', place: SH, unjoined: true },
  { name: 'old-laptop', version: '2.5.0', offlineMs: 21 * DAY + HOUR },
  { name: 'nj-server', place: NJ },
  { name: 'nj-backup', place: NJ },
  { name: 'nj-nuc', place: NJ },
  { name: 'bj-dev', place: BJ },
  { name: 'bj-vps', place: BJ },
  { name: 'hk-vps', place: HK },
  { name: 'hk-mini', place: HK },
  { name: 'sz-box', place: SZ },
  { name: 'tokyo-relay', place: TKY },
  { name: 'la-vps', place: LA },
  { name: 'fra-backup', version: '2.6.4', offlineMs: 2 * DAY + HOUR },
  { name: 'lab-a', place: LAN },
  { name: 'lab-b', place: LAN },
]

const nn = (i: number) => String(i + 1).padStart(2, '0')
const machineId = (i: number) => `00000000-0000-4000-8000-0000000000${nn(i)}`
const ipOf = (i: number) => `10.144.0.${nn(i)}`
const u32 = (i: number) => ((10 << 24) | (144 << 16) | (0 << 8) | (i + 1)) >>> 0
const INFRA_PEER = 999
const peerId = (i: number) => 1000 + i + 1

const idx = (name: string) => {
  const i = ROWS.findIndex((r) => r.name === name)
  if (i < 0) throw new Error(`unknown fleet device ${name}`)
  return i
}
const isOnline = (i: number) => ROWS[i]!.offlineMs === undefined
const isMember = (i: number) => !ROWS[i]!.unjoined

/** Relayed pairs: sorted device indices -> next hop peer id and path latency (ms). */
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
const RELAYS = new Map<string, { hop: number; latency: number }>([
  [pairKey(idx('la-vps'), idx('bj-dev')), { hop: peerId(idx('hk-vps')), latency: 186 }],
  [pairKey(idx('la-vps'), idx('sh-dev')), { hop: peerId(idx('hk-vps')), latency: 170 }],
  [pairKey(idx('tokyo-relay'), idx('bj-vps')), { hop: INFRA_PEER, latency: 95 }],
])

const TUNNELS = ['udp', 'tcp', 'quic']
function directLatencyMs(a: number, b: number): number {
  const la = idx('la-vps')
  if (a === la || b === la) return 150 + ((a === la ? b : a) + 1) % 10
  return 5 + Math.abs(a - b)
}

function routesFor(me: number) {
  const route = (peer: number, hostname: string, addr: number | null, hop: number, latency: number) => ({
    cost: hop === peer ? 1 : 2,
    cost_latency_first: hop === peer ? 1 : 2,
    hostname,
    inst_id: NETWORK_ID,
    ipv4_addr: addr === null ? null : { address: { addr }, network_length: 24 },
    next_hop_peer_id: hop,
    next_hop_peer_id_latency_first: hop,
    path_latency: latency,
    path_latency_latency_first: latency,
    peer_id: peer,
    proxy_cidrs: [],
    version: '2.7.1-fleet',
  })
  const routes = [route(INFRA_PEER, 'public-server', null, INFRA_PEER, 10)]
  ROWS.forEach((r, j) => {
    if (j === me || !isMember(j) || !isOnline(j)) return
    const relay = RELAYS.get(pairKey(me, j))
    routes.push(
      relay
        ? route(peerId(j), r.name, u32(j), relay.hop, relay.latency)
        : route(peerId(j), r.name, u32(j), peerId(j), directLatencyMs(me, j)),
    )
  })
  return routes
}

function peersFor(me: number) {
  const conn = (peer: number, latencyMs: number, tunnel: string, key: number) => ({
    conn_id: `00000000-0000-4000-8000-${String(me * 100 + key).padStart(12, '0')}`,
    my_peer_id: peerId(me),
    network_name: 'home',
    peer_id: peer,
    is_closed: false,
    stats: { latency_us: String(latencyMs * 1000), rx_bytes: '1024', rx_packets: '8', tx_bytes: '2048', tx_packets: '16' },
    tunnel: { tunnel_type: tunnel, remote_addr: { url: `${tunnel}://192.0.2.${key}:11010` } },
  })
  const peers = [{ peer_id: INFRA_PEER, conns: [conn(INFRA_PEER, 10, 'tcp', 99)] }]
  ROWS.forEach((_, j) => {
    if (j === me || !isMember(j) || !isOnline(j) || RELAYS.has(pairKey(me, j))) return
    peers.push({ peer_id: peerId(j), conns: [conn(peerId(j), directLatencyMs(me, j), TUNNELS[(me + 1 + j + 1) % 3]!, j + 1)] })
  })
  return peers
}

/** Mock overrides, machine ids by device name, and the network id. */
export function fleetMock(now: Date = new Date()): { overrides: Overrides; ids: Record<string, string>; networkId: string } {
  const iso = (ms: number) => new Date(ms).toISOString()
  const machines = ROWS.map((r, i) => ({
    client_url: `udp://203.0.113.${i + 1}:11010`,
    info: {
      machine_id: strToUuid(machineId(i)),
      hostname: r.name,
      easytier_version: `${r.version ?? '2.7.1'}-fleet`,
      device_os: { os_type: 'linux', version: '12', distribution: 'Debian' },
    },
    location: isOnline(i) ? r.place : null,
    networks: isMember(i) ? [{ network_id: NETWORK_ID, display_name: '家庭网', network_name: 'home' }] : [],
    online: isOnline(i),
    last_seen: iso(now.getTime() - (r.offlineMs ?? 5_000)),
  }))
  const members = ROWS.flatMap((r, i) =>
    isMember(i)
      ? [{
          member_id: `00000000-0000-4000-9000-0000000000${nn(i)}`,
          device_id: machineId(i),
          hostname: r.name,
          hostname_override: null,
          alias: null,
          virtual_ipv4: null,
          allocated_ipv4: ipOf(i),
          online: isOnline(i),
          running: isOnline(i),
          runtime_virtual_ipv4: isOnline(i) ? `${ipOf(i)}/24` : null,
          version: `${r.version ?? '2.7.1'}-fleet`,
          error_msg: null,
        }]
      : [],
  )
  const idToIndex = new Map(ROWS.map((_, i) => [machineId(i), i]))
  const onlineMembers = ROWS.filter((_, i) => isMember(i) && isOnline(i)).length

  const overrides: Overrides = {
    'GET /machines': () => ({ machines }),
    'GET /networks': () => ({
      networks: [{
        network_id: NETWORK_ID,
        display_name: '家庭网',
        network_name: 'home',
        networking_method: 'Manual',
        virtual_cidr: '10.144.0.0/24',
        secure_mode: false,
        member_count: members.length,
        online_member_count: onlineMembers,
      }],
    }),
    'GET /networks/*/members': () => ({ members, temporary_peers: [] }),
    'GET /blocked-devices': () => ({
      blocked: [{
        id: '99999999-0000-4000-8000-000000000001',
        user_id: 1,
        hostname: 'unknown-pc',
        blocked_time: iso(now.getTime() - HOUR),
        attempt_count: 5,
        last_attempt_time: iso(now.getTime() - 10 * MIN),
      }],
    }),
    'POST /machines/*/proxy-rpc': (req: Request) => {
      const id = new URL(req.url()).pathname.split('/').at(-2)!
      const me = idToIndex.get(id)
      if (me === undefined || !isOnline(me) || !isMember(me)) return {}
      const { method_name } = req.postDataJSON() as { method_name: string }
      if (method_name === 'list_route') return { routes: routesFor(me) }
      if (method_name === 'list_peer') return { peer_infos: peersFor(me) }
      return {}
    },
  }
  return { overrides, ids: Object.fromEntries(ROWS.map((r, i) => [r.name, machineId(i)])), networkId: NETWORK_ID }
}

/** Cached last-known locations of the two offline devices (what `et.locations.<user>` would hold). */
export function fleetLocationCache(ids: Record<string, string>, now: number = Date.now()): LocationCache {
  return {
    [ids['old-laptop']!]: { geo: SH, at: now - 21 * DAY },
    [ids['fra-backup']!]: { geo: { country: '德国', region: '黑森', city: '法兰克福' }, at: now - 2 * DAY },
  }
}
