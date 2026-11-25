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
  /** The device gets an auto-selected address instead of its legacy fixed IP (shared or taken). */
  | 'fixed_ip'

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
  /** Auto-select was chosen but every host address of the subnet is in use. */
  | { kind: 'noFreeIp'; cidr: string }
  /** The device has another instance in this group that migrates (a device joins the network once). */
  | { kind: 'otherInstance'; instance: string }

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
  /** The auto-selected address replacing the legacy fixed IP; null when it keeps its own. */
  newIp: string | null
  /** The device may switch between its own fixed IP and an auto-selected one (it has a fixed IP that conflicts, or is switched). */
  ipSwitchable: boolean
}

export function targetFromDraft(draft: NetworkDraft, gateway: GatewayInfo | null = null): TargetNetwork {
  const f = draft.form
  return {
    networkName: f.networkName.trim(),
    secret: draft.secret,
    method: f.method,
    publicServerUrl: f.method === 'PublicServer' ? f.publicServerUrl.trim() : null,
    // A Gateway network connects to the gateway address (as targetFromDetail).
    peerUrls:
      f.method === 'Manual' ? f.peerUrls.map((u) => u.trim()) : f.method === 'Gateway' && gateway?.peer_url ? [gateway.peer_url] : [],
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
export function classifyInstance(
  config: LegacyConfig,
  deviceHostname: string,
  target: TargetNetwork,
  opts: { newIp?: string | null } = {},
): DevicePlan {
  const legacyIp = fixedIp(config)
  const ip = opts.newIp ?? legacyIp
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
  if (opts.newIp && opts.newIp !== legacyIp) changes.push({ key: 'fixed_ip', from: legacyIp ?? '', to: opts.newIp })

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
 * The highest usable host address of `cidr` not in `used`; null without a subnet or a free address.
 * From the top down: legacy addresses are usually numbered upward from the bottom, so an address
 * nobody could read (an offline device) is least likely up there.
 */
function firstFreeHost(cidr: string | null, used: ReadonlySet<string>): string | null {
  if (!cidr) return null
  const [net, lenText] = cidr.split('/') as [string, string]
  const len = Number(lenText)
  if (len > 30) return null
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0
  const network = (toU32(net) & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  for (let a = broadcast - 1; a > network; a--) {
    const ip = [a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255].join('.')
    if (!used.has(ip)) return ip
  }
  return null
}

const IP_BLOCKERS = new Set<Blocker['kind']>(['ipOutsideCidr', 'duplicateIp', 'ipTaken'])

/**
 * Plans every instance of the group against the target. `selected` is the user's choice (device
 * ids marked 迁移), used to find duplicate fixed IPs among the devices that would migrate.
 * `autoIp`: devices that take an auto-selected address instead of their legacy fixed IP; in device
 * name order each gets the highest host address of the subnet that no legacy instance of the group
 * (running or not, migrating or not), no member, no address in `seen` (the live network's route
 * table) and no earlier pick uses — so it cannot clash with a device still on its legacy config in
 * the same virtual network that could be read or is online.
 */
export function planGroup(
  group: LegacyGroup,
  devices: Map<string, DeviceRef>,
  target: TargetNetwork,
  members: CentralNetworkMember[],
  selected: ReadonlySet<string>,
  autoIp: ReadonlySet<string> = new Set(),
  seen: Iterable<string> = [],
): DevicePreview[] {
  const memberIds = new Set(members.map((m) => m.device_id))
  // A device joins the network once: of several instances of one device in this group, the running
  // one (else the first) is the one that can migrate; the others stay manual instances.
  const primary = new Map<string, string>()
  for (const i of group.instances) {
    const cur = primary.get(i.deviceId)
    const curRunning = group.instances.find((x) => x.instanceId === cur)?.running ?? false
    if (cur === undefined || (i.running && !curRunning)) primary.set(i.deviceId, i.instanceId)
  }
  const used = new Set<string>(seen)
  for (const m of members) {
    for (const a of [m.virtual_ipv4, m.allocated_ipv4, m.runtime_virtual_ipv4]) if (a) used.add(a.split('/')[0]!)
  }
  for (const i of group.instances) {
    const ip = fixedIp(i.config)
    if (ip) used.add(ip)
  }
  const base = group.instances.map((instance) => {
    const device = devices.get(instance.deviceId) ?? { id: instance.deviceId, name: instance.deviceId, hostname: '', online: false }
    const alreadyMember = memberIds.has(instance.deviceId)
    const legacyIp = fixedIp(instance.config)
    const primaryId = primary.get(instance.deviceId)!
    const secondary = primaryId !== instance.instanceId
    const auto = autoIp.has(device.id) && !secondary && !alreadyMember && !!legacyIp && !!target.virtualCidr
    let newIp: string | null = null
    if (auto) {
      newIp = firstFreeHost(target.virtualCidr, used)
      if (newIp) used.add(newIp)
    }
    const plan = classifyInstance(instance.config, device.hostname, target, { newIp })
    return { instance, device, plan, alreadyMember, legacyIp, auto, newIp, secondary, primaryId }
  })
  return base.map(({ instance, device, plan, alreadyMember, legacyIp, auto, newIp, secondary, primaryId }) => {
    const blockers: Blocker[] = []
    if (secondary) {
      if (!alreadyMember) blockers.push({ kind: 'otherInstance', instance: primaryId })
    } else if (auto) {
      if (!newIp) blockers.push({ kind: 'noFreeIp', cidr: target.virtualCidr! })
    } else {
      const ip = plan.member.virtualIpv4
      if (!alreadyMember && ip) {
        if (!hostInCidr(ip, target.virtualCidr)) blockers.push({ kind: 'ipOutsideCidr', ip, cidr: target.virtualCidr! })
        // A member holds an address fixed, allocated or at runtime (a fixed one would silently re-address it).
        const taken = members.find(
          (m) => m.device_id !== device.id && [m.virtual_ipv4, m.allocated_ipv4, m.runtime_virtual_ipv4].some((a) => a?.split('/')[0] === ip),
        )
        if (taken) blockers.push({ kind: 'ipTaken', ip, other: memberLabel(taken) })
        const dup = base.find(
          (o) => o.device.id !== device.id && !o.alreadyMember && !o.auto && !o.secondary && selected.has(o.device.id) && o.plan.member.virtualIpv4 === ip,
        )
        if (dup) blockers.push({ kind: 'duplicateIp', ip, other: dup.device.name })
      }
    }
    const fixedBlockers = blockers.filter((b) => b.kind !== 'duplicateIp')
    return {
      instance,
      device,
      plan,
      blockers,
      alreadyMember,
      defaultSelected: instance.running && !alreadyMember && fixedBlockers.length === 0,
      newIp,
      ipSwitchable: !secondary && !alreadyMember && !!legacyIp && !!target.virtualCidr && (auto || blockers.some((b) => IP_BLOCKERS.has(b.kind))),
    }
  })
}

/**
 * A confirmed `fixed_ip` change holds for the address it was confirmed for: picks are recomputed as
 * choices change, so when a device's address moves (or it keeps its own) the confirmation is
 * dropped and must be given again. `confirmedIps` remembers the address per device. Returns the
 * same objects when nothing changed.
 */
export function reconcileIpConfirmations(
  previews: DevicePreview[],
  confirmed: Record<string, ChangeKey[]>,
  confirmedIps: Record<string, string>,
): { confirmed: Record<string, ChangeKey[]>; confirmedIps: Record<string, string> } {
  let nextConfirmed = confirmed
  let nextIps = confirmedIps
  const drop = (id: string) => {
    if (nextConfirmed === confirmed) nextConfirmed = { ...confirmed }
    nextConfirmed[id] = (confirmed[id] ?? []).filter((k) => k !== 'fixed_ip')
  }
  const setIp = (id: string, ip: string | undefined) => {
    if (nextIps === confirmedIps) nextIps = { ...confirmedIps }
    if (ip === undefined) delete nextIps[id]
    else nextIps[id] = ip
  }
  for (const p of previews) {
    if (p.blockers.some((b) => b.kind === 'otherInstance')) continue
    const id = p.device.id
    const recorded = confirmedIps[id]
    if (!(confirmed[id] ?? []).includes('fixed_ip')) {
      if (recorded !== undefined) setIp(id, undefined)
      continue
    }
    if (p.newIp === null || (recorded !== undefined && recorded !== p.newIp)) {
      drop(id)
      if (recorded !== undefined) setIp(id, undefined)
    } else if (recorded === undefined) setIp(id, p.newIp)
  }
  return { confirmed: nextConfirmed, confirmedIps: nextIps }
}

/** Devices (not instances) that will migrate and that will not. */
export function deviceCounts(previews: DevicePreview[], selected: DevicePreview[]): { migrate: number; skip: number } {
  const migrate = new Set(selected.map((p) => p.device.id)).size
  return { migrate, skip: new Set(previews.map((p) => p.device.id)).size - migrate }
}

/** The 迁移 / 暂不迁移 defaults per device: chosen when the instance that can migrate is selected by default. */
export function initialChoices(previews: DevicePreview[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const p of previews) out[p.device.id] = (out[p.device.id] ?? false) || p.defaultSelected
  return out
}

/**
 * The devices that start on an auto-selected address when step 3 opens: of every fixed IP shared
 * by running devices, all but the first by name; and every running device whose fixed IP a member
 * of the target network already holds. A fixed IP outside the subnet is left to the user (the
 * subnet is more likely wrong). Disabled instances are never switched.
 */
export function initialAutoIp(
  group: LegacyGroup,
  devices: Map<string, DeviceRef>,
  target: TargetNetwork,
  members: CentralNetworkMember[],
): Set<string> {
  const out = new Set<string>()
  if (!target.virtualCidr) return out
  const running = new Set(group.instances.filter((i) => i.running).map((i) => i.deviceId))
  const seen = new Set<string>()
  for (const p of planGroup(group, devices, target, members, running)) {
    if (!p.instance.running || p.alreadyMember) continue
    const kinds = new Set(p.blockers.map((b) => b.kind))
    if (kinds.has('ipOutsideCidr')) continue
    const ip = p.plan.member.virtualIpv4
    if (kinds.has('ipTaken')) out.add(p.device.id)
    else if (kinds.has('duplicateIp') && ip) {
      if (seen.has(ip)) out.add(p.device.id)
      else seen.add(ip)
    }
  }
  return out
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
