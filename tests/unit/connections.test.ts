import { describe, expect, it } from 'vitest'
import routesFx from '../fixtures/v2.7.1/list-route-core1.json'
import peersFx from '../fixtures/v2.7.1/list-peer-core1.json'
import membersFx from '../fixtures/v2.7.1/members.json'
import machinesFx from '../fixtures/v2.7.1/machines.json'
import type { CentralNetworkMember, NodePeerInfo, NodeRouteInfo, TemporaryPeer } from '../../src/api/types'
import { classifyPeers, pairStats, type PeerLink } from '../../src/domain/connections'
import { uuidToStr } from '../../src/lib/uuid'

const routes = routesFx.routes as unknown as NodeRouteInfo[]
const peers = peersFx.peer_infos as unknown as NodePeerInfo[]
const members = membersFx.members as unknown as CentralNetworkMember[]
const deviceNames: Record<string, string> = {}
for (const m of machinesFx.machines as any[]) deviceNames[uuidToStr(m.info.machine_id)] = m.info.hostname

const route = (peer_id: number, extra: Partial<NodeRouteInfo> = {}): NodeRouteInfo =>
  ({ peer_id, hostname: `h${peer_id}`, cost: 1, path_latency: 1, proxy_cidrs: [], version: '', next_hop_peer_id: peer_id, ...extra }) as NodeRouteInfo
const conn = (extra: any = {}) => ({ conn_id: 'c', tunnel: { tunnel_type: 'TCP' }, ...extra })
const base = { members: [], temporaryPeers: [] as TemporaryPeer[], deviceNames: {} }

describe('classifyPeers', () => {
  it('fixture: core1 sees core2 and core3 as members', () => {
    const links = classifyPeers({ routes, peers, members, temporaryPeers: [], deviceNames })
    expect(links.map(l => l.name).sort()).toEqual(['core2', 'core3'])
    for (const l of links) {
      expect(l.kind).toBe('member')
      expect(l.mode).toEqual({ type: 'p2p', tunnel: 'tcp' })
    }
    const core3 = links.find(l => l.name === 'core3')!
    expect(core3.deviceId).toBe('33333333-3333-4333-8333-333333333333')
    const pc = peers.find(p => p.peer_id === core3.peerId)!.conns[0]!
    expect(core3.rxBytes).toBe(Number(pc.stats!.rx_bytes))
    expect(core3.txBytes).toBe(Number(pc.stats!.tx_bytes))
    expect(core3.latencyMs).toBe(Number(pc.stats!.latency_us) / 1000)
  })

  it('relay via next hop', () => {
    const links = classifyPeers({
      ...base,
      routes: [route(2, { hostname: 'two' }), route(3, { next_hop_peer_id: 2, path_latency: 40 })],
      peers: [{ peer_id: 2, conns: [conn()] }],
    })
    const l = links.find(x => x.peerId === 3)!
    expect(l.mode).toEqual({ type: 'relay', via: 'two' })
    expect(l.latencyMs).toBe(40)
    expect(l.rxBytes).toBeNull()
  })

  it('relay via falls back to #id', () => {
    const [l] = classifyPeers({ ...base, routes: [route(3, { next_hop_peer_id: 9 })], peers: [] })
    expect(l!.mode).toEqual({ type: 'relay', via: '#9' })
  })

  it('closed conns are not p2p', () => {
    const [l] = classifyPeers({
      ...base,
      routes: [route(3, { path_latency: 7 })],
      peers: [{ peer_id: 3, conns: [conn({ is_closed: true })] }],
    })
    expect(l!.mode.type).toBe('relay')
    expect(l!.latencyMs).toBe(7)
  })

  it('p2p aggregates open conns: min latency, summed bytes; missing stats -> null', () => {
    const [a, b] = classifyPeers({
      ...base,
      routes: [route(3), route(4)],
      peers: [
        { peer_id: 3, conns: [
          conn({ stats: { latency_us: '5000', rx_bytes: '10', tx_bytes: 1 } }),
          conn({ stats: { latency_us: 2000, rx_bytes: '5', tx_bytes: '2' } }),
          conn({ is_closed: true, stats: { latency_us: 1, rx_bytes: 100, tx_bytes: 100 } }),
        ] },
        { peer_id: 4, conns: [conn()] },
      ],
    })
    expect(a!.latencyMs).toBe(2)
    expect(a!.rxBytes).toBe(15)
    expect(a!.txBytes).toBe(3)
    expect(b!.latencyMs).toBeNull()
    expect(b!.rxBytes).toBeNull()
    expect(b!.txBytes).toBeNull()
  })

  it('tunnel unknown when missing', () => {
    const [l] = classifyPeers({ ...base, routes: [route(3)], peers: [{ peer_id: 3, conns: [{ conn_id: 'x' }] }] })
    expect(l!.mode).toEqual({ type: 'p2p', tunnel: 'unknown' })
  })

  it('unknown peer is infra; temporary matched by peer_id', () => {
    const links = classifyPeers({
      ...base,
      routes: [route(5, { hostname: 'relay-node' }), route(6, { hostname: 'guest' })],
      peers: [],
      temporaryPeers: [{ peer_id: 6, credential_id: null, credential_expiry_unix: null, hostname: 'guest', ipv4: '10.0.0.9/24', version: null }],
    })
    expect(links.find(l => l.peerId === 5)).toMatchObject({ kind: 'infra', deviceId: null, name: 'relay-node' })
    expect(links.find(l => l.peerId === 6)).toMatchObject({ kind: 'temporary', deviceId: null })
  })

  it('temporary matched by ip; member matched by hostname', () => {
    const m = { ...members[0]!, runtime_virtual_ipv4: null, virtual_ipv4: null, allocated_ipv4: null, hostname: 'byname', device_id: 'dev-x' } as CentralNetworkMember
    const links = classifyPeers({
      ...base,
      members: [m],
      routes: [
        route(7, { hostname: 'byname' }),
        route(8, { hostname: 'x', ipv4_addr: { address: { addr: (10 << 24) + 9 } } }),
      ],
      peers: [],
      temporaryPeers: [{ peer_id: 99, credential_id: null, credential_expiry_unix: null, hostname: null, ipv4: '10.0.0.9/24', version: null }],
    })
    expect(links.find(l => l.peerId === 7)).toMatchObject({ kind: 'member', deviceId: 'dev-x', name: 'byname' })
    expect(links.find(l => l.peerId === 8)).toMatchObject({ kind: 'temporary', ip: '10.0.0.9' })
  })
})

const L = (deviceId: string | null, p2p: boolean, kind: PeerLink['kind'] = 'member'): PeerLink => ({
  peerId: 1, name: 'n', ip: null, kind, deviceId,
  mode: p2p ? { type: 'p2p', tunnel: 'tcp' } : { type: 'relay', via: 'x' },
  latencyMs: null, rxBytes: null, txBytes: null,
})

describe('pairStats', () => {
  it('dedups and prefers direct', () => {
    const r = pairStats({
      A: [L('B', true), L('C', false), L('Z', true, 'infra')],
      B: [L('A', false)],
      C: [L('A', false)],
    })
    expect(r).toEqual({ direct: 1, relayed: 1, rate: 0.5 })
  })
  it('ignores self links and empty input', () => {
    expect(pairStats({})).toEqual({ direct: 0, relayed: 0, rate: null })
    expect(pairStats({ A: [L('A', true)] }).rate).toBeNull()
  })
})
