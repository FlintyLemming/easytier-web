// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later
// Source of the credential join helpers: easytier-web/frontend/src/components/NetworkDetail.vue.
import type {
  CentralNetworkDetail,
  CentralNetworkMember,
  GatewayInfo,
  NetworkSettings,
  NetworkingMethod,
} from '../api/types'
import { listenerRule } from '../components/config-editor/rules'
import { isIpv4Cidr } from './cidr'
import { memberIp } from './devices'

// --- network settings (create dialog and settings tab) ---

export interface SettingsForm {
  displayName: string
  networkName: string
  method: NetworkingMethod
  publicServerUrl: string
  peerUrls: string[]
  virtualCidr: string
  secureMode: boolean
}

export type SettingsError = 'displayName' | 'publicServerUrl' | 'peerUrls' | 'virtualCidr' | 'networkName'

/** Same as the backend (`NetworkSettings::normalize_virtual_cidr`): blank → none, a bare address → /24. */
export function normalizeVirtualCidr(text: string): string | null {
  const v = text.trim()
  if (!v) return null
  return v.includes('/') ? v : `${v}/24`
}

export function settingsFormFrom(detail: CentralNetworkDetail): SettingsForm {
  const method = detail.networking_method as NetworkingMethod
  return {
    displayName: detail.display_name,
    networkName: detail.network_name,
    method,
    publicServerUrl: method === 'PublicServer' ? (detail.public_server_url ?? '') : '',
    // A Gateway network's peer list is the gateway address, which the backend manages.
    peerUrls: method === 'Manual' ? [...(detail.peer_urls ?? [])] : [],
    virtualCidr: detail.virtual_cidr ?? '',
    secureMode: detail.secure_mode ?? false,
  }
}

export function settingsErrors(form: SettingsForm): Partial<Record<SettingsError, 'required' | 'url' | 'cidr'>> {
  const out: Partial<Record<SettingsError, 'required' | 'url' | 'cidr'>> = {}
  if (!form.displayName.trim()) out.displayName = 'required'
  if (/\s/.test(form.networkName.trim())) out.networkName = 'required'
  if (form.method === 'PublicServer') {
    const url = form.publicServerUrl.trim()
    if (!url) out.publicServerUrl = 'required'
    else if (listenerRule(url)) out.publicServerUrl = 'url'
  }
  if (form.method === 'Manual') {
    if (form.peerUrls.length === 0) out.peerUrls = 'required'
    else if (form.peerUrls.some((u) => listenerRule(u.trim()))) out.peerUrls = 'url'
  }
  const cidr = normalizeVirtualCidr(form.virtualCidr)
  if (cidr !== null && !isIpv4Cidr(cidr)) out.virtualCidr = 'cidr'
  return out
}

/**
 * The settings body. On update an unchanged network name is sent as null (the backend keeps it);
 * only the selected method's addresses are sent.
 */
export function settingsPayload(form: SettingsForm, original?: CentralNetworkDetail): NetworkSettings {
  const name = form.networkName.trim()
  const networkName = original ? (name === original.network_name || !name ? null : name) : name || null
  return {
    display_name: form.displayName.trim(),
    network_name: networkName,
    networking_method: form.method,
    public_server_url: form.method === 'PublicServer' ? form.publicServerUrl.trim() : null,
    peer_urls: form.method === 'Manual' ? form.peerUrls.map((u) => u.trim()) : [],
    virtual_cidr: normalizeVirtualCidr(form.virtualCidr),
    secure_mode: form.secureMode,
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function settingsImpacts(
  form: SettingsForm,
  original: CentralNetworkDetail,
): ('networkName' | 'virtualCidr' | 'method' | 'secureMode')[] {
  const out: ('networkName' | 'virtualCidr' | 'method' | 'secureMode')[] = []
  const p = settingsPayload(form, original)
  if (p.network_name !== null) out.push('networkName')
  if (p.virtual_cidr !== (original.virtual_cidr ?? null)) out.push('virtualCidr')
  const sameMethod = p.networking_method === original.networking_method
  const sameAddresses =
    p.networking_method === 'PublicServer'
      ? p.public_server_url === (original.public_server_url ?? null)
      : p.networking_method === 'Manual'
        ? sameList(p.peer_urls, original.peer_urls ?? [])
        : true
  if (!sameMethod || !sameAddresses) out.push('method')
  if (p.secure_mode !== (original.secure_mode ?? false)) out.push('secureMode')
  return out
}

/** 32 random bytes in base64, the backend's own secret format. */
export function randomNetworkSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

// --- members ---

export type MemberState = 'running' | 'stopped' | 'error' | 'starting' | 'offline'

export interface MemberRow {
  deviceId: string
  memberId: string
  name: string
  ip: string | null
  ipKind: 'fixed' | 'auto' | 'none'
  version: string
  state: MemberState
  errorMsg: string | null
  temporary: boolean
  expiryUnix: number | null
  online: boolean
}

export function memberName(m: CentralNetworkMember): string {
  return m.alias || m.hostname_override || m.hostname || m.device_id.slice(0, 8)
}

function memberState(m: CentralNetworkMember): MemberState {
  if (!m.online) return 'offline'
  if (m.error_msg) return 'error'
  if (m.running === true) return 'running'
  if (m.running === false) return 'stopped'
  return 'starting'
}

export function memberRows(members: CentralNetworkMember[]): MemberRow[] {
  const rows = members.map((m): MemberRow => {
    const ip = memberIp(m)
    return {
      deviceId: m.device_id,
      memberId: m.member_id,
      name: memberName(m),
      ip,
      ipKind: m.virtual_ipv4 ? 'fixed' : ip ? 'auto' : 'none',
      version: m.version ?? '',
      state: memberState(m),
      errorMsg: m.error_msg || null,
      temporary: m.temporary === true,
      expiryUnix: m.credential_expiry_unix ?? null,
      online: m.online,
    }
  })
  return rows.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'zh-CN'))
}

// --- credentials ---

/** A temporary member's own credential is `member-<member_id>`. */
export function credentialMemberId(credentialId: string): string | null {
  return credentialId.startsWith('member-') ? credentialId.slice('member-'.length) : null
}

// Ported from upstream NetworkDetail.vue (credentialJoinPeer / Command / Toml); see the file header.

/** The node a credential holder should dial: the public server, the gateway, else the first peer. */
export function joinPeer(detail: CentralNetworkDetail, gateway: GatewayInfo | null): string {
  if (detail.networking_method === 'PublicServer') return detail.public_server_url ?? ''
  if (detail.networking_method === 'Gateway' && gateway?.peer_url) return gateway.peer_url
  return detail.peer_urls?.[0] ?? ''
}

export function credentialJoinCommand(detail: CentralNetworkDetail, gateway: GatewayInfo | null, secret: string): string {
  const peer = joinPeer(detail, gateway)
  return [
    'easytier-core',
    `--network-name ${detail.network_name}`,
    '--secure-mode',
    `--credential ${secret}`,
    peer ? `-p ${peer}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const tomlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Config-file form of the same join; unlike upstream, no `[[peer]]` section without a peer. */
export function credentialJoinToml(detail: CentralNetworkDetail, gateway: GatewayInfo | null, secret: string): string {
  const peer = joinPeer(detail, gateway)
  const lines = ['[network_identity]', `network_name = ${tomlString(detail.network_name)}`]
  if (peer) lines.push('', '[[peer]]', `uri = ${tomlString(peer)}`)
  lines.push('', '[secure_mode]', 'enabled = true', `local_private_key = ${tomlString(secret)}`)
  return lines.join('\n')
}

export const CREDENTIAL_TTLS: readonly { hours: number; key: string }[] = Object.freeze([
  { hours: 1, key: '1h' },
  { hours: 24, key: '24h' },
  { hours: 168, key: '7d' },
  { hours: 720, key: '30d' },
  { hours: 8760, key: '365d' },
])

export const MEMBER_TTLS: readonly { hours: number; key: string }[] = Object.freeze([
  { hours: 24, key: '24h' },
  { hours: 168, key: '7d' },
  { hours: 720, key: '30d' },
])
