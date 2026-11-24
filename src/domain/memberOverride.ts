import { isDefaultValue, toBackendNetworkConfig, type NetworkConfig } from '../lib/networkConfig'

/**
 * Fields the central network compiler always overwrites when it applies a member's config override
 * (upstream `easytier-web/src/central_network/compiler.rs`, `apply_member_override`). Whatever an
 * override says about them is ignored, so they never make a member "overridden".
 */
export const CENTRAL_OWNED_FIELDS: readonly string[] = Object.freeze([
  'instance_id',
  'dhcp',
  'dhcp_ipv4_cidr',
  'dhcpv6',
  'dhcp_ipv6_cidr',
  'virtual_ipv4',
  'network_length',
  'hostname',
  'network_name',
  'network_secret',
  'networking_method',
  'public_server_url',
  'peer_urls',
  'peers',
  'secure_mode',
  'managed_credentials',
  'acl',
  'credential_file',
])

/** Managed through `PATCH member { proxy_cidrs }`, which stores them inside the override object. */
const MEMBER_FIELDS = ['proxy_cidrs']

const IGNORED = new Set([...CENTRAL_OWNED_FIELDS, ...MEMBER_FIELDS])

/**
 * `has_override` only says an override object exists (PATCHing proxy_cidrs creates one), so decide
 * from the object itself: overridden when any field other than the central-owned ones and
 * `proxy_cidrs` carries a value that differs from the flag's declared default (a value equal to the
 * default overrides nothing).
 */
export function overrideState(config: Record<string, unknown> | null | undefined): 'default' | 'overridden' {
  if (!config) return 'default'
  for (const [k, v] of Object.entries(config)) {
    if (IGNORED.has(k)) continue
    if (!isDefaultValue(k, v)) return 'overridden'
  }
  return 'default'
}

export type ResetOverridePlan = { kind: 'delete' } | { kind: 'put'; config: { proxy_cidrs: string[] } }

/**
 * "Restore default" without losing subnet proxies: with proxy_cidrs, PUT a default object carrying
 * only them (the same object the backend creates on PATCH); otherwise DELETE the override.
 */
export function resetOverridePlan(config: Record<string, unknown> | null | undefined): ResetOverridePlan {
  const raw = config?.proxy_cidrs
  const cidrs = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && c !== '') : []
  return cidrs.length > 0 ? { kind: 'put', config: { proxy_cidrs: cidrs } } : { kind: 'delete' }
}

/**
 * What to write for a member override edited through the config form: the backend form of the draft
 * without the central-owned fields and with the member's `proxy_cidrs`; a draft with nothing but
 * defaults left becomes the reset plan so the stored override stays minimal.
 */
export function memberOverridePayload(
  form: NetworkConfig,
  proxyCidrs: string[],
): { kind: 'put'; config: Record<string, unknown> } | ResetOverridePlan {
  const config: Record<string, unknown> = { ...toBackendNetworkConfig(form) }
  for (const field of CENTRAL_OWNED_FIELDS) delete config[field]
  if (proxyCidrs.length > 0) config.proxy_cidrs = proxyCidrs
  else delete config.proxy_cidrs

  if (overrideState(config) === 'default') return resetOverridePlan({ proxy_cidrs: proxyCidrs })
  return { kind: 'put', config }
}
