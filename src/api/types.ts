// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later
// Source: easytier-web/frontend/src/modules/api.ts (interfaces), corrected to match real responses.

export interface UuidParts {
  part1?: number
  part2?: number
  part3?: number
  part4?: number
}

export interface Summary {
  device_count: number
}

export interface CentralNetworkSummary {
  network_id: string
  display_name: string
  network_name: string
  networking_method: string
  virtual_cidr?: string | null
  secure_mode?: boolean
  member_count: number
  online_member_count: number
}

/** `GET /networks/{id}`: the detail answer has no online_member_count. */
export type CentralNetworkDetail = Omit<CentralNetworkSummary, 'online_member_count'> & {
  network_secret: string
  public_server_url?: string | null
  peer_urls: string[]
}

export type NetworkingMethod = 'PublicServer' | 'Manual' | 'Standalone' | 'Gateway'

/** The settings object `POST /networks` and `PATCH /networks/{id}` take (all keys required). */
export interface NetworkSettings {
  display_name: string
  /** null: let the backend generate one (create) or keep the current one (update). */
  network_name: string | null
  networking_method: NetworkingMethod
  public_server_url: string | null
  peer_urls: string[]
  virtual_cidr: string | null
  secure_mode: boolean
}

export interface GatewayInfo {
  enabled: boolean
  peer_url?: string
  relay_data?: boolean
}

// --- central ACL policy (easytier-web central_network/model.rs, plain serde JSON) ---

export type AclAction = 'allow' | 'deny'
export type AclProtocol = 'tcp' | 'udp' | 'icmp' | 'icmpv6' | 'any'
export type AclSource = { type: 'all' } | { type: 'member'; member_id: string } | { type: 'group'; name: string }
export type AclDestination =
  | { type: 'all' }
  | { type: 'member'; member_id: string }
  | { type: 'subnet'; member_id: string; cidrs: string[] }
export interface AclProtocolTarget {
  protocol: AclProtocol
  ports: string[]
  stateful: boolean
}
export interface AclRule {
  id: string
  name: string
  enabled: boolean
  action: AclAction
  sources: AclSource[]
  destinations: AclDestination[]
  protocols: AclProtocolTarget[]
}
export interface AclPolicy {
  default_action: AclAction
  rules: AclRule[]
}

export interface NetworkCredential {
  credential_id: string
  credential_secret: string
  expiry_unix: number
  reusable: boolean
  online_peers: TemporaryPeer[]
}

export interface CentralNetworkMember {
  member_id: string
  device_id: string
  hostname: string | null
  hostname_override: string | null
  alias?: string | null
  virtual_ipv4: string | null
  allocated_ipv4?: string | null
  online: boolean
  running: boolean | null
  runtime_virtual_ipv4: string | null
  version: string | null
  error_msg: string | null
  has_override?: boolean
  proxy_cidrs?: string[]
  temporary?: boolean
  credential_id?: string | null
  credential_expiry_unix?: number | null
}

export interface NodeRouteInfo {
  peer_id: number
  hostname: string
  ipv4_addr?: { address?: { addr?: number }; network_length?: number } | null
  cost: number
  path_latency: number
  proxy_cidrs: string[]
  version: string
  next_hop_peer_id: number
}

export interface NodePeerConn {
  conn_id: string
  tunnel?: { tunnel_type?: string; local_addr?: any; remote_addr?: any } | null
  // 64-bit counters arrive as JSON strings.
  stats?: { latency_us?: number | string; rx_bytes?: number | string; tx_bytes?: number | string } | null
  loss_rate?: number
  // Omitted by the backend when false.
  is_closed?: boolean
}

export interface NodePeerInfo {
  peer_id: number
  conns: NodePeerConn[]
}

export interface NodeAclRuleStat {
  rule?: { name?: string }
  // 64-bit counters; may arrive as JSON strings like the peer stats.
  stat?: { packet_count?: number | string; byte_count?: number | string }
}

/// A device currently online through a credential; `credential_id` is null
/// when it matches no stored credential anymore (e.g. revoked mid-flight).
export interface TemporaryPeer {
  peer_id: number
  credential_id: string | null
  credential_expiry_unix: number | null
  hostname: string | null
  ipv4: string | null
  version: string | null
}

export interface BlockedDevice {
  id: string
  user_id: number
  hostname: string
  alias?: string | null
  blocked_time: string
  attempt_count: number
  last_attempt_time?: string | null
}

export interface ConsoleInfo {
  username: string
  config_server_protocol: string
  config_server_port: number
  // Added on main; absent on v2.7.1.
  config_server_host?: string | null
  webhook_auth: boolean
}

export interface GeoText {
  country: string
  region?: string | null
  city?: string | null
}

export interface HeartbeatInfo {
  machine_id?: UuidParts
  hostname?: string
  easytier_version?: string
  report_time?: string
  running_network_instances?: UuidParts[]
  device_os?: unknown
}

export interface RawMachine {
  client_url?: string | null
  info?: HeartbeatInfo | null
  location?: GeoText | null
  alias?: string | null
  networks?: { network_id: string; display_name: string; network_name: string }[]
  online?: boolean
  last_seen?: string | null
}

export type MemberPatch = {
  hostname_override?: string | null
  virtual_ipv4?: string | null
  proxy_cidrs?: string[]
}

// --- per-device instances ---

export interface InstanceList {
  running: string[]
  disabled: string[]
}

export type ConfigSource = 'web' | 'user' | 'unspecified'

export interface InstanceMeta {
  networkName: string
  instanceName: string
  source: ConfigSource
  permission: number
}

export const CONFIG_READ_ONLY = 1
export const CONFIG_NO_DELETE = 2

export interface InstanceRunningInfo {
  running: boolean
  error_msg?: string | null
  my_node_info?: {
    virtual_ipv4?: { address?: { addr?: number }; network_length?: number } | null
    ips?: unknown
  } | null
  peer_route_pairs?: { route?: { ipv4_addr?: unknown } | null }[]
  [k: string]: unknown
}

export type VpnClientPatch =
  | { action: 'ADD'; client: { name: string; virtual_ip: string; groups: string[] } }
  | { action: 'REMOVE'; client: { name: string; virtual_ip: ''; groups: [] } }
  | { action: 'CLEAR' }
