import { toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { isIpv4, isIpv4Cidr } from '../../domain/cidr'
import { defaultFlagValue, type NetworkConfig } from '../../lib/networkConfig'

type Rec = Record<string, unknown>

/**
 * A deep copy of a draft with no reactive proxy left anywhere inside (structuredClone throws on
 * one). Records, protobuf messages included, become plain objects.
 */
export function cloneConfig<T>(value: T): T {
  const v = toRaw(value) as unknown
  if (Array.isArray(v)) return v.map((x) => cloneConfig(x)) as T
  if (v === null || typeof v !== 'object') return v as T
  if (ArrayBuffer.isView(v) || v instanceof Date) return structuredClone(v) as T
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneConfig(x)])) as T
}

// --- switches ---

/** What a switch shows: the value the draft states, else the flag's declared default. */
export function flagOn(draft: NetworkConfig, field: string): boolean {
  const value = (draft as unknown as Rec)[field]
  return value === undefined || value === null ? defaultFlagValue(field as keyof NetworkConfig) : Boolean(value)
}

/** A switch set back to its default leaves the field out; any other value is written explicitly. */
export function setFlag(draft: NetworkConfig, field: string, on: boolean): void {
  const rec = draft as unknown as Rec
  if (on === defaultFlagValue(field as keyof NetworkConfig)) delete rec[field]
  else rec[field] = on
}

export const PROXY_FLAGS = ['enable_kcp_proxy', 'disable_kcp_input', 'enable_quic_proxy', 'disable_quic_input']

/** Switches with a place in their own section, which the 其他开关 list leaves out. */
export const SECTION_FLAGS = new Set(['latency_first', 'disable_encryption', ...PROXY_FLAGS, 'enable_magic_dns'])

// --- validation ---

/** The `config.invalid.*` key a value fails with, or null when it is fine. */
export type Invalid = 'required' | 'cidr' | 'ipv4' | 'port' | 'mtu' | 'url' | 'networkLength'
type Rule<T> = (value: T) => Invalid | null

export const requiredRule: Rule<string | undefined> = (v) => (v ? null : 'required')
export const cidrRule: Rule<string> = (v) => (!v ? 'required' : isIpv4Cidr(v) ? null : 'cidr')
export const ipv4Rule: Rule<string> = (v) => (!v ? 'required' : isIpv4(v) ? null : 'ipv4')
export const listenerRule: Rule<string> = (v) =>
  !v ? 'required' : /^[a-z][a-z0-9+.-]*:\/\/\S+:\d{1,5}(\/\S*)?$/i.test(v) ? null : 'url'

const intIn = (v: number | null | undefined, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

export const portRule: Rule<number | null | undefined> = (v) => (intIn(v, 1, 65535) ? null : 'port')
export const networkLengthRule: Rule<number | null | undefined> = (v) => (intIn(v, 1, 32) ? null : 'networkLength')
/** Blank means the default MTU. */
export const mtuRule: Rule<number | null | undefined> = (v) => (v === null || v === undefined || intIn(v, 400, 1380) ? null : 'mtu')

/** Translates a rule's result for display under the field. */
export function useInvalidText(): (key: Invalid | null) => string | undefined {
  const { t } = useI18n()
  return (key) => (key ? t(`config.invalid.${key}`) : undefined)
}

/** A number input's value: null when blank (browsers also blank out unparseable input). */
export function inputNumber(e: Event): number | null {
  const raw = (e.target as HTMLInputElement).value
  return raw === '' ? null : Number(raw)
}

// --- legacy (pre-2.7) VPN portal network, one CIDR over two fields ---

/** Shows exactly what `parseLegacyNetwork` stored, so typing never jumps. */
export function legacyNetworkText(addr: string | undefined, len: number | undefined): string {
  if (typeof len === 'number' && Number.isFinite(len)) return `${addr ?? ''}/${len}`
  return addr ?? ''
}

/** Anything that is not `<text>/<number>` goes into the address whole, with no prefix length. */
export function parseLegacyNetwork(text: string): { addr: string; len: number } {
  const m = /^(.*)\/(0|[1-9]\d*)$/.exec(text)
  return m ? { addr: m[1]!, len: Number(m[2]) } : { addr: text, len: NaN }
}

export const legacyNetworkRule = (addr: string | undefined, len: number | undefined): Invalid | null =>
  cidrRule(legacyNetworkText(addr, len))

// --- VPN portal (2.7+) ---

export function vpnPortalOn(draft: NetworkConfig): boolean {
  return !!draft.vpn_portal_config && draft.vpn_portal_config.enabled !== false
}

// --- the whole draft ---

/** Whether every field the form shows for this mode holds a valid value. */
export function draftValid(d: NetworkConfig, opts: { mode: 'member' | 'instance'; legacyVpn: boolean }): boolean {
  const checks: (Invalid | null)[] = []
  const each = <T>(items: T[] | undefined, rule: Rule<T>) => (items ?? []).forEach((x) => checks.push(rule(x)))

  if (opts.mode === 'instance') {
    checks.push(requiredRule(d.network_name))
    each(d.peer_urls, requiredRule)
    if (!flagOn(d, 'dhcp')) checks.push(ipv4Rule(d.virtual_ipv4 ?? ''), networkLengthRule(d.network_length))
    each(d.proxy_cidrs, cidrRule)
  }
  each(d.listener_urls, listenerRule)
  checks.push(mtuRule(d.mtu))
  for (const pf of d.port_forwards ?? []) {
    checks.push(ipv4Rule(pf.bind_ip), portRule(pf.bind_port), ipv4Rule(pf.dst_ip), portRule(pf.dst_port))
  }
  if (opts.legacyVpn) {
    if (flagOn(d, 'enable_vpn_portal')) {
      checks.push(portRule(d.vpn_portal_listen_port), legacyNetworkRule(d.vpn_portal_client_network_addr, d.vpn_portal_client_network_len))
    }
  } else if (vpnPortalOn(d)) {
    checks.push(requiredRule(d.vpn_portal_config!.wireguard_listen))
    for (const c of d.vpn_portal_config!.clients ?? []) checks.push(requiredRule(c.name), cidrRule(c.virtual_ip))
  }
  return checks.every((c) => c === null)
}
