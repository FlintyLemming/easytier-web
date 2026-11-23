const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`)
const CIDR_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}/(3[0-2]|[12]?\\d)$`)

export function isIpv4(s: string): boolean {
  return IPV4_RE.test(s)
}

export function isIpv4Cidr(s: string): boolean {
  return CIDR_RE.test(s)
}

function toU32(ip: string): number {
  return ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0)
}

function inCidr(ip: string, cidr: string): boolean {
  if (!isIpv4Cidr(cidr)) return false
  const [net, len] = cidr.split('/') as [string, string]
  const bits = Number(len)
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return ((toU32(ip) & mask) >>> 0) === ((toU32(net) & mask) >>> 0)
}

/**
 * Suggested subnet-proxy CIDRs: the /24 around each interface address of the device, skipping
 * loopback, link-local, the network's own virtual range and CIDRs that are already present.
 */
export function candidateCidrs(
  interfaceIps: string[],
  opts: { existing?: string[]; virtualCidr?: string | null } = {},
): string[] {
  const seen = new Set(opts.existing ?? [])
  const out: string[] = []
  for (const ip of interfaceIps) {
    if (!isIpv4(ip)) continue
    if (inCidr(ip, '127.0.0.0/8') || inCidr(ip, '169.254.0.0/16') || inCidr(ip, '0.0.0.0/8')) continue
    if (opts.virtualCidr && inCidr(ip, opts.virtualCidr)) continue
    const cidr = ip.split('.').slice(0, 3).join('.') + '.0/24'
    if (seen.has(cidr)) continue
    seen.add(cidr)
    out.push(cidr)
  }
  return out
}
