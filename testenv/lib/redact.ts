// Scrubs data that must never land in committed fixtures:
// - the capturing machine's real internet address, which cores learn via STUN
//   (`stun_info.public_ip`) and report as `ip_list.public_ipv4` / `public_ipv6`;
// - ACL `group_secret` values the backend generates for central networks
//   (as TOML text inside `show_node_info.config`, or as structured JSON).
// Any other public IPv4 that shows up (dotted in a string, or as a numeric
// `addr`, the u32 Ipv4Addr proto shape) is replaced too, as a safety net.

export const REDACTED_GROUP_SECRET = 'redacted-group-secret'
// RFC 5737 documentation addresses.
export const DOC_IPV4 = ['203.0.113.10', '198.51.100.20', '192.0.2.30', '203.0.113.40', '198.51.100.50', '192.0.2.60']
export const DOC_PUBLIC_IPV4_U32 = 3405803786 // 203.0.113.10 as a big-endian u32
// 2001:db8::10 (RFC 3849) in the Ipv6Addr proto shape.
const DOC_PUBLIC_IPV6 = { part1: 0x20010db8, part2: 0, part3: 0, part4: 0x10 }

export function ipv4ToU32(ip: string): number {
  return ip.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0)
}

export function u32ToIpv4(a: number): string {
  return [24, 16, 8, 0].map((s) => (a >>> s) & 255).join('.')
}

// Private, loopback, unspecified and documentation ranges: safe to commit.
const SAFE_RANGES: [string, number][] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['0.0.0.0', 32],
  ['192.0.2.0', 24],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
]

function isSafeIpv4(ip: string): boolean {
  const n = ipv4ToU32(ip)
  return SAFE_RANGES.some(([net, len]) => {
    const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0
    return ((n & mask) >>> 0) === ((ipv4ToU32(net) & mask) >>> 0)
  })
}

const DOTTED_IPV4 = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?!\d|\.\d)/g
const TOML_GROUP_SECRET = /(group_secret\s*=\s*)(?:"[^"\n]*"|'[^'\n]*')/g

export const REDACTED_KEY = 'redacted-key'
// WireGuard keys inside text (`PrivateKey = ...` / `PublicKey = ...`), e.g. a client_config / vpn_portal_cfg.
const WG_KEY_LINE = /^(\s*(?:Private|Public)Key\s*=\s*).*$/gim

export function redact<T>(data: T): T {
  const seen = new Map<string, string>()
  const docFor = (ip: string) => {
    let d = seen.get(ip)
    if (!d) {
      d = DOC_IPV4[seen.size % DOC_IPV4.length]!
      seen.set(ip, d)
    }
    return d
  }
  const str = (s: string) =>
    s
      .replace(WG_KEY_LINE, `$1${REDACTED_KEY}`)
      .replace(TOML_GROUP_SECRET, `$1"${REDACTED_GROUP_SECRET}"`)
      .replace(DOTTED_IPV4, (ip) => (ip.split('.').every((o) => Number(o) <= 255) && !isSafeIpv4(ip) ? docFor(ip) : ip))

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return str(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v === null || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === 'group_secret' && typeof x === 'string') out[k] = REDACTED_GROUP_SECRET
      else if (/_private_key$/.test(k) && typeof x === 'string') out[k] = REDACTED_KEY
      else if (k === 'public_ip' && Array.isArray(x)) out[k] = x.map((_, i) => DOC_IPV4[i % DOC_IPV4.length])
      else if (k === 'public_ipv4' && x && typeof x === 'object' && 'addr' in x) out[k] = { ...x, addr: DOC_PUBLIC_IPV4_U32 }
      else if (k === 'public_ipv6' && x && typeof x === 'object') out[k] = { ...DOC_PUBLIC_IPV6 }
      else if (k === 'addr' && typeof x === 'number' && !isSafeIpv4(u32ToIpv4(x))) out[k] = ipv4ToU32(docFor(u32ToIpv4(x)))
      else out[k] = walk(x)
    }
    return out
  }
  return walk(data) as T
}
