import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'v2.7.1')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): any => JSON.parse(readFileSync(join(dir, name), 'utf8'))

test('machines.json has >=3 machines with info.machine_id, online, networks', () => {
  const { machines } = load('machines.json')
  assert.ok(machines.length >= 3)
  for (const m of machines) {
    assert.ok(m.info?.machine_id !== undefined, 'info.machine_id')
    assert.ok('online' in m, 'online')
    assert.ok('networks' in m, 'networks')
  }
})

test('members.json has 3 members, one with virtual_ipv4 10.144.144.1', () => {
  const { members } = load('members.json')
  assert.equal(members.length, 3)
  assert.ok(members.some((m: { virtual_ipv4?: string }) => m.virtual_ipv4 === '10.144.144.1'))
})

test('list-route-core1.json has >=2 routes with next_hop_peer_id and path_latency', () => {
  const { routes } = load('list-route-core1.json')
  const withBoth = routes.filter(
    (r: object) => 'next_hop_peer_id' in r && 'path_latency' in r,
  )
  assert.ok(withBoth.length >= 2)
})

test('blocked-devices.json has >=1 blocked', () => {
  assert.ok(load('blocked-devices.json').blocked.length >= 1)
})

test('instance fixtures: list has the fixed instance and the central network, config keeps hidden fields', () => {
  const { networkId } = load('index.json')
  const uuid = (u: { part1: number; part2: number; part3: number; part4: number }) => {
    const h = [u.part1, u.part2, u.part3, u.part4].map((p) => (p >>> 0).toString(16).padStart(8, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  const running = load('instances-core2.json').running_inst_ids.map(uuid)
  assert.ok(running.includes('5eed0000-0000-4000-8000-000000000001'))
  assert.ok(running.includes(networkId))
  const cfg = load('instance-config-core2.json')
  for (const k of ['routes', 'exit_nodes', 'acl', 'port_forwards']) assert.ok(cfg[k], k)
  // The testenv cores (v2.6.4) only run the legacy VPN portal fields.
  assert.ok(cfg.enable_vpn_portal === true || cfg.vpn_portal_config, 'vpn portal')
  assert.equal(load('instance-info-core2.json').info.map['5eed0000-0000-4000-8000-000000000001'].running, true)
  assert.deepEqual(load('instance-info-disabled.json'), { info: {} })
})

test('parse-config-error has an error and a null config; member-config-empty is {}', () => {
  const e = load('parse-config-error.json')
  assert.ok(e.error)
  assert.equal(e.config, null)
  assert.deepEqual(load('member-config-empty.json'), {})
  assert.ok(load('parse-config-ok.json').config)
  assert.ok(load('generate-config-ok.json').toml_config)
})

test('no fixture contains /Users/', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.ok(files.length >= 15)
  for (const f of files) assert.ok(!readFileSync(join(dir, f), 'utf8').includes('/Users/'), f)
})

// ---------- privacy: no real public IPs, no ACL group secrets ----------
// The allowed ranges are spelled out here on purpose (not imported from lib/redact.ts),
// so this guard does not trust the redaction code it is checking.

const ALLOWED_V4: [string, number][] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['0.0.0.0', 32],
  ['192.0.2.0', 24], // RFC 5737 documentation ranges
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
]
const toU32 = (ip: string) => ip.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0)
const fromU32 = (a: number) => [24, 16, 8, 0].map((s) => (a >>> s) & 255).join('.')
const allowedV4 = (ip: string) =>
  ALLOWED_V4.some(([net, len]) => {
    const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0
    return ((toU32(ip) & mask) >>> 0) === ((toU32(net) & mask) >>> 0)
  })
const DOTTED = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?!\d|\.\d)/g
const TOML_SECRET = /group_secret\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')/g
const PLACEHOLDER = 'redacted-group-secret'

interface Scan {
  dotted: string[] // every dotted IPv4 found in any string
  u32: { path: string; ip: string }[] // every numeric `addr` (Ipv4Addr proto: public_ipv4, interface_ipv4s[], route ipv4_addr.address)
  secrets: string[] // every group_secret value, structured or inside TOML text
}
function scan(v: unknown, path = '$', out: Scan = { dotted: [], u32: [], secrets: [] }): Scan {
  if (typeof v === 'string') {
    for (const m of v.matchAll(DOTTED)) out.dotted.push(m[1]!)
    for (const m of v.matchAll(TOML_SECRET)) out.secrets.push(m[1] ?? m[2]!)
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => scan(x, `${path}[${i}]`, out))
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'addr' && typeof x === 'number') out.u32.push({ path: `${path}.addr`, ip: fromU32(x) })
      if (k === 'group_secret' && typeof x === 'string') out.secrets.push(x)
      scan(x, `${path}.${k}`, out)
    }
  }
  return out
}
const allFixtures = () =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, data: load(f) }))

test('no fixture contains a public IPv4 (dotted strings or u32 addr fields)', () => {
  let dottedSeen = 0
  let u32Seen = 0
  const bad: string[] = []
  for (const { f, data } of allFixtures()) {
    const s = scan(data)
    dottedSeen += s.dotted.length
    u32Seen += s.u32.length
    for (const ip of s.dotted) if (ip.split('.').every((o) => Number(o) <= 255) && !allowedV4(ip)) bad.push(`${f}: ${ip}`)
    for (const { path, ip } of s.u32) if (!allowedV4(ip)) bad.push(`${f}: ${path} = ${ip}`)
  }
  assert.ok(dottedSeen > 0 && u32Seen > 0, 'scan found no IPv4 values at all; the check would be vacuous')
  assert.deepEqual(bad, [])
})

test('show-node-info public_ipv4 / stun public_ip are documentation addresses', () => {
  const ni = load('show-node-info-core3.json').node_info
  const pub = ni.ip_list?.public_ipv4?.addr
  if (pub !== undefined) assert.equal(pub, 3405803786) // 203.0.113.10
  for (const ip of ni.stun_info?.public_ip ?? []) assert.match(ip, /^(192\.0\.2|198\.51\.100|203\.0\.113)\./)
})

test('no fixture contains an ACL group_secret other than the placeholder', () => {
  const bad: string[] = []
  for (const { f, data } of allFixtures()) {
    for (const s of scan(data).secrets) if (s !== PLACEHOLDER) bad.push(`${f}: ${s.slice(0, 6)}…`)
  }
  assert.deepEqual(bad, [])
})

test('no fixture contains WireGuard key material', () => {
  const bad: string[] = []
  for (const { f } of allFixtures()) {
    const text = readFileSync(join(dir, f), 'utf8')
    for (const m of text.matchAll(/(?:Private|Public)Key\s*=\s*([^\\\s"]*)/g)) if (m[1] !== 'redacted-key') bad.push(`${f}: ${m[0].slice(0, 14)}…`)
    for (const m of text.matchAll(/"([A-Za-z0-9+/]{43}=)"/g)) bad.push(`${f}: base64 key-shaped ${m[1]!.slice(0, 6)}…`)
  }
  assert.deepEqual(bad, [])
})

test('redact() scrubs WireGuard keys', async () => {
  const { redact } = await import('./lib/redact.ts')
  const key = 'A'.repeat(43) + '='
  const out = redact({ t: `[Interface]\nPrivateKey = ${key}\nAddress = 10.0.0.1/32\n[Peer]\nPublicKey = ${key}\n`, wireguard_private_key: key })
  assert.ok(!JSON.stringify(out).includes(key))
  assert.ok(out.t.includes('Address = 10.0.0.1/32'))
  assert.equal(out.wireguard_private_key, 'redacted-key')
})

test('redact() scrubs public IPs and group secrets, keeps private ones', async () => {
  const { redact } = await import('./lib/redact.ts')
  const input = {
    node_info: {
      config: 'ipv4 = "10.144.144.3/24"\n[[acl.acl_v1.group.declares]]\ngroup_secret = "c2VjcmV0"\n',
      ip_list: { public_ipv4: { addr: 16843009 }, interface_ipv4s: [{ addr: 3232260356 }, { addr: 134744072 }] }, // 1.1.1.1; 192.168.97.4, 8.8.8.8
      stun_info: { public_ip: ['1.1.1.1', '9.9.9.9'] },
      listeners: ['tcp://8.8.4.4:11010', 'udp://192.168.97.4:11010'],
    },
    declares: [{ group_name: 'g', group_secret: 'c2VjcmV0' }],
  }
  const out = redact(input)
  const s = scan(out)
  assert.deepEqual(s.secrets, [PLACEHOLDER, PLACEHOLDER])
  for (const ip of s.dotted) assert.ok(allowedV4(ip), ip)
  for (const { ip } of s.u32) assert.ok(allowedV4(ip), ip)
  assert.equal(out.node_info.ip_list.public_ipv4.addr, 3405803786)
  assert.deepEqual(out.node_info.stun_info.public_ip, ['203.0.113.10', '198.51.100.20'])
  assert.equal(out.node_info.ip_list.interface_ipv4s[0]!.addr, 3232260356) // 192.168.97.4 kept
  assert.ok(out.node_info.config.includes('ipv4 = "10.144.144.3/24"'))
  assert.ok(out.node_info.listeners.includes('udp://192.168.97.4:11010'))
  assert.equal(input.node_info.stun_info.public_ip[0], '1.1.1.1', 'input not mutated')
})

// ---------- consistency: every network reference is the captured network ----------

test('every network_id / inst_id referenced in the fixtures equals index.networkId', () => {
  const { networkId } = load('index.json')
  assert.match(networkId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  const uuid = (u: { part1: number; part2: number; part3: number; part4: number }) => {
    const h = [u.part1, u.part2, u.part3, u.part4].map((p) => (p >>> 0).toString(16).padStart(8, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  const refs: { where: string; id: string }[] = []
  const walk = (v: unknown, where: string) => {
    if (typeof v === 'string') {
      // TOML config text from show_node_info: `instance_id = "<uuid>"`
      for (const m of v.matchAll(/^instance_id\s*=\s*"([^"]+)"/gm)) refs.push({ where: `${where}(toml instance_id)`, id: m[1]! })
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${where}[${i}]`))
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const at = `${where}.${k}`
        if ((k === 'network_id' || k === 'inst_id') && typeof x === 'string') refs.push({ where: at, id: x })
        // machines[].info.inst_id is a UUID object: the core process's own session id from its
        // heartbeat, not a network instance, so it is not compared. Network instances it runs are
        // listed in running_network_instances.
        if (k === 'running_network_instances' && Array.isArray(x)) x.forEach((u, i) => refs.push({ where: `${at}[${i}]`, id: uuid(u) }))
        walk(x, at)
      }
    }
  }
  // The per-device instance fixtures describe other (manual) instances, not the central network.
  const instanceFixtures = new Set(['instances-core2.json', 'instance-metas-core2.json', 'instance-config-core2.json',
    'instance-info-core2.json', 'generate-config-ok.json', 'parse-config-ok.json'])
  for (const { f, data } of allFixtures()) if (!instanceFixtures.has(f)) walk(data, f)
  const files = new Set(refs.map((r) => r.where.slice(0, r.where.indexOf('.json') + 5)))
  for (const f of ['network.json', 'networks.json', 'machines.json', 'list-route-core1.json', 'show-node-info-core3.json']) {
    assert.ok(files.has(f), `no network reference found in ${f}`)
  }
  assert.deepEqual(
    refs.filter((r) => r.id.toLowerCase() !== networkId).map((r) => `${r.where} = ${r.id}`),
    [],
  )
})
