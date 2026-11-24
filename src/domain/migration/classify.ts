import type { CentralNetworkDetail, CentralNetworkMember, GatewayInfo, NetworkingMethod } from '../../api/types'
import { CENTRAL_OWNED_FIELDS } from '../memberOverride'
import { LEGACY_VPN_FIELDS } from '../vpnPortal'
import { normalizeVirtualCidr } from '../networks'
import { effectivePeers, fixedIp, networkLength } from './inventory'
import type { DeviceRef, LegacyConfig, LegacyGroup, LegacyInstance, NetworkDraft } from './types'
import { isUnset } from './values'

export { isUnset }

/** Spec §5.10.2 step 3, category 3: what the central network cannot express and will change. */
export type ChangeKey =
  | 'connectivity' | 'network_name' | 'network_secret' | 'dhcp' | 'network_length' | 'secure_mode' | 'acl' | 'vpn_portal'
  | 'dhcp_ipv4_cidr' | 'dhcpv6' | 'dhcp_ipv6_cidr' | 'managed_credentials' | 'credential_file'

/**
 * Display text of a change. Secrets read '••••' on both sides. `acl`: `from` is the rule count.
 * `vpn_portal`: `from` describes the legacy portal, `to` is 'off' (an enabled portal turns off) or
 * 'dropped' (leftover fields of a portal that was not enabled).
 */
export interface Change {
  key: ChangeKey
  from: string
  to: string
}

export type Blocker =
  | { kind: 'ipOutsideCidr'; ip: string; cidr: string }
  | { kind: 'duplicateIp'; ip: string; other: string }
  | { kind: 'ipTaken'; ip: string; other: string }

export interface MemberFields {
  virtualIpv4: string | null
  hostnameOverride: string | null
  proxyCidrs: string[]
}

export interface DevicePlan {
  member: MemberFields
  /** The member's config override, without `proxy_cidrs` (written together with it). */
  override: LegacyConfig
  changes: Change[]
  legacyAcl: unknown | null
}

export interface TargetNetwork {
  networkName: string
  secret: string
  method: NetworkingMethod
  publicServerUrl: string | null
  /** Manual: the peer URLs; Gateway: the gateway address. */
  peerUrls: string[]
  virtualCidr: string | null
  secureMode: boolean
}

export interface DevicePreview {
  instance: LegacyInstance
  device: DeviceRef
  plan: DevicePlan
  blockers: Blocker[]
  alreadyMember: boolean
  defaultSelected: boolean
}

export function targetFromDraft(draft: NetworkDraft): TargetNetwork {
  const f = draft.form
  return {
    networkName: f.networkName.trim(),
    secret: draft.secret,
    method: f.method,
    publicServerUrl: f.method === 'PublicServer' ? f.publicServerUrl.trim() : null,
    peerUrls: f.method === 'Manual' ? f.peerUrls.map((u) => u.trim()) : [],
    virtualCidr: normalizeVirtualCidr(f.virtualCidr),
    secureMode: f.secureMode,
  }
}

export function targetFromDetail(detail: CentralNetworkDetail, gateway: GatewayInfo | null): TargetNetwork {
  const method = detail.networking_method as NetworkingMethod
  const gatewayUrl = gateway?.peer_url ?? detail.peer_urls?.[0]
  return {
    networkName: detail.network_name,
    secret: detail.network_secret,
    method,
    publicServerUrl: method === 'PublicServer' ? (detail.public_server_url ?? null) : null,
    peerUrls: method === 'Gateway' ? (gatewayUrl ? [gatewayUrl] : []) : method === 'Manual' ? [...(detail.peer_urls ?? [])] : [],
    virtualCidr: detail.virtual_cidr ?? null,
    secureMode: detail.secure_mode ?? false,
  }
}

function targetPeers(t: TargetNetwork): string[] {
  if (t.method === 'Standalone') return []
  if (t.method === 'PublicServer') return t.publicServerUrl ? [t.publicServerUrl] : []
  return [...new Set(t.peerUrls.filter((u) => u !== ''))].sort()
}

const prefixOf = (cidr: string | null) => (cidr ? Number(cidr.split('/')[1]) : 24)
const MASKED = '••••'
const MEMBER_FIELDS = new Set(['virtual_ipv4', 'hostname', 'proxy_cidrs'])
const NOT_OVERRIDE = new Set<string>([...CENTRAL_OWNED_FIELDS, ...MEMBER_FIELDS, ...LEGACY_VPN_FIELDS])
const OTHER_CENTRAL: ChangeKey[] = ['dhcp_ipv4_cidr', 'dhcpv6', 'dhcp_ipv6_cidr', 'managed_credentials', 'credential_file']

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])

function vpnChange(config: LegacyConfig): Change | null {
  if (LEGACY_VPN_FIELDS.every((f) => isUnset(f, config[f]))) return null
  const addr = config.vpn_portal_client_network_addr
  const len = config.vpn_portal_client_network_len
  const port = config.vpn_portal_listen_port
  const from = [addr ? `${String(addr)}/${String(len ?? 24)}` : '', port ? String(port) : ''].filter(Boolean).join(' · ')
  return { key: 'vpn_portal', from, to: config.enable_vpn_portal === true ? 'off' : 'dropped' }
}

function aclRuleCount(acl: unknown): number {
  const chains = (acl as { acl_v1?: { chains?: { rules?: unknown[] }[] } } | null)?.acl_v1?.chains ?? []
  return chains.reduce((n, c) => n + (c.rules?.length ?? 0), 0)
}

/** Spec §5.10.2 step 3: split a legacy config into member fields, the override and the changes. */
export function classifyInstance(config: LegacyConfig, deviceHostname: string, target: TargetNetwork): DevicePlan {
  const ip = fixedIp(config)
  const hostname = typeof config.hostname === 'string' ? config.hostname.trim() : ''
  const member: MemberFields = {
    virtualIpv4: ip,
    hostnameOverride: hostname && hostname !== deviceHostname ? hostname : null,
    proxyCidrs: strings(config.proxy_cidrs),
  }

  const override: LegacyConfig = {}
  for (const [k, v] of Object.entries(config)) {
    if (NOT_OVERRIDE.has(k) || isUnset(k, v)) continue
    override[k] = v
  }

  const changes: Change[] = []
  const fromPeers = effectivePeers(config)
  const toPeers = targetPeers(target)
  if (fromPeers.join(', ') !== toPeers.join(', ')) changes.push({ key: 'connectivity', from: fromPeers.join(', '), to: toPeers.join(', ') })
  const name = typeof config.network_name === 'string' ? config.network_name : ''
  if (name !== target.networkName) changes.push({ key: 'network_name', from: name, to: target.networkName })
  const secret = typeof config.network_secret === 'string' ? config.network_secret : ''
  if (secret !== target.secret) changes.push({ key: 'network_secret', from: MASKED, to: MASKED })
  const legacyDhcp = config.dhcp === true
  const memberDhcp = ip === null && target.virtualCidr === null
  if (legacyDhcp !== memberDhcp) changes.push({ key: 'dhcp', from: String(legacyDhcp), to: String(memberDhcp) })
  const fromLen = networkLength(config)
  const toLen = prefixOf(target.virtualCidr)
  if (!legacyDhcp && fromLen !== toLen) changes.push({ key: 'network_length', from: String(fromLen), to: String(toLen) })
  const legacySecure = (config.secure_mode as { enabled?: unknown } | null | undefined)?.enabled === true
  if (legacySecure !== target.secureMode) changes.push({ key: 'secure_mode', from: String(legacySecure), to: String(target.secureMode) })
  const legacyAcl = isUnset('acl', config.acl) ? null : config.acl
  if (legacyAcl !== null) changes.push({ key: 'acl', from: String(aclRuleCount(legacyAcl)), to: '' })
  const vpn = vpnChange(config)
  if (vpn) changes.push(vpn)
  for (const key of OTHER_CENTRAL) {
    if (!isUnset(key, config[key])) changes.push({ key, from: JSON.stringify(config[key]), to: '' })
  }

  return { member, override, changes, legacyAcl }
}

const toU32 = (ip: string) => ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0)

/** Usable host address of the subnet (not its network or broadcast address); true without a subnet. */
function hostInCidr(ip: string, cidr: string | null): boolean {
  if (!cidr) return true
  const [net, lenText] = cidr.split('/') as [string, string]
  const len = Number(lenText)
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0
  const network = (toU32(net) & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const a = toU32(ip)
  return a > network && a < broadcast
}

const memberLabel = (m: CentralNetworkMember) => m.alias || m.hostname || m.device_id

/**
 * Plans every instance of the group against the target. `selected` is the user's choice (device
 * ids marked 迁移), used to find duplicate fixed IPs among the devices that would migrate.
 */
export function planGroup(
  group: LegacyGroup,
  devices: Map<string, DeviceRef>,
  target: TargetNetwork,
  members: CentralNetworkMember[],
  selected: ReadonlySet<string>,
): DevicePreview[] {
  const memberIds = new Set(members.map((m) => m.device_id))
  const base = group.instances.map((instance) => {
    const device = devices.get(instance.deviceId) ?? { id: instance.deviceId, name: instance.deviceId, hostname: '', online: false }
    return { instance, device, plan: classifyInstance(instance.config, device.hostname, target), alreadyMember: memberIds.has(instance.deviceId) }
  })
  return base.map(({ instance, device, plan, alreadyMember }) => {
    const blockers: Blocker[] = []
    const ip = plan.member.virtualIpv4
    if (!alreadyMember && ip) {
      if (!hostInCidr(ip, target.virtualCidr)) blockers.push({ kind: 'ipOutsideCidr', ip, cidr: target.virtualCidr! })
      const taken = members.find((m) => m.device_id !== device.id && m.virtual_ipv4?.split('/')[0] === ip)
      if (taken) blockers.push({ kind: 'ipTaken', ip, other: memberLabel(taken) })
      const dup = base.find(
        (o) => o.device.id !== device.id && !o.alreadyMember && selected.has(o.device.id) && o.plan.member.virtualIpv4 === ip,
      )
      if (dup) blockers.push({ kind: 'duplicateIp', ip, other: dup.device.name })
    }
    const fixedBlockers = blockers.filter((b) => b.kind !== 'duplicateIp')
    return {
      instance,
      device,
      plan,
      blockers,
      alreadyMember,
      defaultSelected: instance.running && !alreadyMember && fixedBlockers.length === 0,
    }
  })
}

/** The config fields a change covers (verification ignores them once the change is confirmed). */
export function changeFields(key: ChangeKey): string[] {
  switch (key) {
    case 'connectivity':
      return ['networking_method', 'public_server_url', 'peer_urls', 'peers']
    case 'vpn_portal':
      return [...LEGACY_VPN_FIELDS, 'vpn_portal_config']
    case 'dhcp':
      return ['dhcp', 'virtual_ipv4']
    case 'secure_mode':
      // A secure network compiles its credentials into every member.
      return ['secure_mode', 'managed_credentials']
    default:
      return [key]
  }
}

/** The plan's change keys that are not in `confirmed`, in plan order. */
export function unconfirmedChanges(plan: DevicePlan, confirmed: ReadonlySet<ChangeKey>): ChangeKey[] {
  return plan.changes.map((c) => c.key).filter((k) => !confirmed.has(k))
}

/** The devices that will migrate: chosen (迁移), without blockers, not members already. */
export function selectedPreviews(previews: DevicePreview[], choices: Record<string, boolean>): DevicePreview[] {
  return previews.filter((p) => choices[p.device.id] === true && p.blockers.length === 0 && !p.alreadyMember)
}

/**
 * Step 3 may proceed: at least one device migrates, every change of those devices is confirmed,
 * and no device chosen for 迁移 still shares its fixed IP with another chosen one.
 */
export function readyToRun(
  previews: DevicePreview[],
  choices: Record<string, boolean>,
  confirmed: Record<string, ChangeKey[]>,
): boolean {
  const selected = selectedPreviews(previews, choices)
  if (selected.length === 0) return false
  const unresolved = previews.some((p) => choices[p.device.id] === true && !p.alreadyMember && p.blockers.some((b) => b.kind === 'duplicateIp'))
  if (unresolved) return false
  return selected.every((p) => unconfirmedChanges(p.plan, new Set(confirmed[p.device.id] ?? [])).length === 0)
}
