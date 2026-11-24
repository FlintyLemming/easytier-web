// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later
import type { InstanceRunningInfo } from '../api/types'
import type { VpnPortalConfig } from '../lib/networkConfig'
import { isIpv4 } from './cidr'
import { ipv4FromU32 } from './format'
import { parseVersion } from './version'

export function createVpnPortalConfig(): VpnPortalConfig {
  const key = crypto.getRandomValues(new Uint8Array(32))
  key[0]! &= 248
  key[31] = (key[31]! & 127) | 64
  return {
    wireguard_listen: '0.0.0.0:22022',
    wireguard_private_key: btoa(String.fromCharCode(...key)),
    clients: [],
  }
}

// --- legacy (pre-2.7) VPN portal fields ---

/**
 * Cores older than 2.7 only understand these fields and silently drop `vpn_portal_config`, while
 * web 2.7.1 rejects them in generate-config, so they are kept apart from the rest of a config.
 */
export const LEGACY_VPN_FIELDS = [
  'enable_vpn_portal',
  'vpn_portal_listen_port',
  'vpn_portal_client_network_addr',
  'vpn_portal_client_network_len',
] as const

export function splitLegacyVpn<T extends object>(config: T): { rest: T; legacy: Record<string, unknown> } {
  const rest = { ...config } as Record<string, unknown>
  const legacy: Record<string, unknown> = {}
  for (const field of LEGACY_VPN_FIELDS) {
    const value = rest[field]
    if (value !== undefined) legacy[field] = value
    delete rest[field]
  }
  return { rest: rest as T, legacy }
}

/** Whether a node of this version, or a config carrying legacy fields, needs the legacy VPN portal. */
export function usesLegacyVpn(version: string, config?: object | null): boolean {
  const carries = !!config && LEGACY_VPN_FIELDS.some((f) => (config as Record<string, unknown>)[f] !== undefined)
  const v = parseVersion(version)
  if (!v) return carries
  const old = v[0] < 2 || (v[0] === 2 && v[1] < 7)
  return old || carries
}

// --- endpoint ---

function listenerUrl(listener: string): URL | undefined {
  try {
    return new URL(listener.includes('://') ? listener : `wg://${listener}`)
  } catch {
    return undefined
  }
}

function ipv6ToString(parts: number[]): string {
  const groups = parts.flatMap((p) => [(p >>> 16) & 0xffff, p & 0xffff])
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) { bestStart = i; bestLen = j - i }
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestLen < 2) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

/** The `host:port` clients should dial: the listener's host, or the node's public address for a wildcard. */
export function vpnPortalEndpoint(listener: string, info: InstanceRunningInfo | null): string {
  const url = listenerUrl(listener)
  if (!url?.port || url.port === '0') return ''

  const ips = info?.my_node_info?.ips as
    | { public_ipv4?: { addr?: number }; public_ipv6?: Record<string, number> }
    | null
    | undefined
  const v4 = ips?.public_ipv4?.addr
  const ipv4 = v4 ? ipv4FromU32(v4) : ''
  const v6 = ips?.public_ipv6
  const parts = v6 ? [v6.part1, v6.part2, v6.part3, v6.part4].map((p) => p ?? 0) : []
  const ipv6 = parts.some((p) => p) ? `[${ipv6ToString(parts)}]` : ''
  const wildcard = url.hostname === '0.0.0.0' || url.hostname === '[::]'
  const host = wildcard ? ipv4 || ipv6 : url.hostname
  return host ? `${host}:${url.port}` : ''
}

export function normalizeVpnPortalEndpoint(value: string, port: string): string {
  const input = value.trim()
  if (!input || /[\s/#?@]/.test(input)) return ''
  const url = listenerUrl(input)
  if (!url || ['0.0.0.0', '[::]'].includes(url.hostname)) return ''
  const resolvedPort = url.port || port
  if (!resolvedPort || Number(resolvedPort) < 1 || Number(resolvedPort) > 65535) return ''
  return `${url.hostname}:${resolvedPort}`
}

/** Replaces the whole `Endpoint =` line, trailing comment of the legacy template included. */
export function vpnPortalClientConfig(config: string, endpoint: string): string {
  if (!config || !endpoint) return ''
  // A replacer function, so `$&` or `$1` in a typed endpoint stay as typed.
  return config.replace(/^Endpoint\s*=.*$/m, () => `Endpoint = ${endpoint}`)
}

// --- addresses ---

function ipv4Number(value: string): number | undefined {
  if (!isIpv4(value)) return undefined
  return value.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0)
}

function addrOf(v: unknown): number | undefined {
  if (typeof v === 'string') return ipv4Number(v.split('/')[0]!)
  const addr = (v as { address?: { addr?: number } } | null | undefined)?.address?.addr
  return typeof addr === 'number' ? addr >>> 0 : undefined
}

/** Addresses already taken in the instance's network: clients, this node and its peers. */
export function vpnPortalUsedIps(
  info: InstanceRunningInfo | null,
  clients: { virtual_ip: string }[],
): Set<number> {
  const addresses = clients.map((c) => ipv4Number(c.virtual_ip.split('/')[0]!))
  addresses.push(addrOf(info?.my_node_info?.virtual_ipv4))
  for (const pair of info?.peer_route_pairs ?? []) addresses.push(addrOf(pair.route?.ipv4_addr))
  return new Set(addresses.filter((a): a is number => a !== undefined))
}

function cidrRange(cidr: string): { first: number; last: number; prefix: number } | undefined {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(cidr)
  const ip = m ? ipv4Number(m[1]!) : undefined
  const prefix = m ? Number(m[2]) : NaN
  if (ip === undefined || !(prefix >= 0 && prefix <= 32)) return undefined
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const first = (ip & mask) >>> 0
  return { first, last: (first | (~mask >>> 0)) >>> 0, prefix }
}

/** The first free host address of the clients' network (or, without clients, the instance's own). */
export function suggestVpnPortalAddress(
  info: InstanceRunningInfo | null,
  clients: { virtual_ip: string }[],
  used: Set<number>,
): { address: string; prefix?: number } {
  const local = info?.my_node_info?.virtual_ipv4
  const localAddr = addrOf(local)
  const cidr =
    clients[0]?.virtual_ip ||
    (localAddr !== undefined && local?.network_length !== undefined
      ? `${ipv4FromU32(localAddr)}/${local.network_length}`
      : '')
  const range = cidrRange(cidr)
  if (!range) return { address: '' }
  for (let address = range.first + 1; address < range.last; address++) {
    if (!used.has(address)) return { address: ipv4FromU32(address), prefix: range.prefix }
  }
  return { address: '', prefix: range.prefix }
}

/**
 * A host address of its /prefix network that is not taken. With `network` (a CIDR such as the
 * instance's `10.88.0.0/24`) the address must also lie inside that network.
 */
export function validVpnPortalAddress(
  address: string,
  prefix: number | undefined,
  used: Set<number>,
  network?: string,
): boolean {
  const parsed = ipv4Number(address)
  if (parsed === undefined || used.has(parsed) || prefix === undefined) return false
  const range = cidrRange(`${address}/${prefix}`)
  if (!range || !(parsed > range.first && parsed < range.last)) return false
  if (network) {
    const net = cidrRange(network)
    if (!net || parsed < net.first || parsed > net.last) return false
  }
  return true
}

export function validVpnClientName(name: string): boolean {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(name)
}
