import { Md5 } from 'ts-md5'
import { strToUuid } from '../lib/uuid'
import { ipv4FromU32 } from '../domain/format'
import { ApiError, apiUrl, request } from './http'
import type {
  BlockedDevice,
  CentralNetworkMember,
  CentralNetworkSummary,
  ConsoleInfo,
  MemberPatch,
  NodeAclRuleStat,
  NodePeerInfo,
  NodeRouteInfo,
  RawMachine,
  TemporaryPeer,
} from './types'

/** Every interpolated path segment goes through this (ids may contain `/`, spaces, …). */
const seg = (s: string) => encodeURIComponent(s)

// --- auth ---

export async function login(username: string, password: string): Promise<void> {
  await request('POST', '/auth/login', { body: { username, password: Md5.hashStr(password) } })
}

export async function register(username: string, password: string, captcha: string): Promise<void> {
  await request('POST', '/auth/register', {
    body: { credentials: { username, password: Md5.hashStr(password) }, captcha },
  })
}

export async function logout(): Promise<void> {
  try {
    await request('GET', '/auth/logout')
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return
    throw e
  }
}

export async function checkLogin(): Promise<boolean> {
  try {
    await request('GET', '/auth/check_login_status')
    return true
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return false
    throw e
  }
}

export async function changePassword(newPassword: string): Promise<void> {
  await request('PUT', '/auth/password', { body: { new_password: Md5.hashStr(newPassword) } })
}

export async function getOidcConfig(): Promise<{ enabled: boolean }> {
  try {
    return (await request<{ enabled: boolean }>('GET', '/auth/oidc/config')) ?? { enabled: false }
  } catch {
    return { enabled: false }
  }
}

export function captchaUrl(): string {
  return apiUrl('/auth/captcha')
}

export function oidcLoginUrl(): string {
  return apiUrl('/auth/oidc/login')
}

// --- console ---

export function getConsoleInfo(): Promise<ConsoleInfo> {
  return request<ConsoleInfo>('GET', '/console-info')
}

// --- devices ---

export async function listMachines(): Promise<RawMachine[]> {
  const r = await request<{ machines?: RawMachine[] }>('GET', '/machines')
  return r?.machines ?? []
}

export async function deleteMachine(id: string, block: boolean): Promise<void> {
  await request('DELETE', `/machines/${seg(id)}`, block ? { query: { block: true } } : undefined)
}

export async function setMachineAlias(id: string, alias: string): Promise<void> {
  await request('PUT', `/machines/${seg(id)}/alias`, { body: { alias } })
}

export async function listBlockedDevices(): Promise<BlockedDevice[]> {
  const r = await request<{ blocked?: BlockedDevice[] }>('GET', '/blocked-devices')
  return r?.blocked ?? []
}

export async function unblockDevice(id: string): Promise<void> {
  await request('DELETE', `/blocked-devices/${seg(id)}`)
}

// --- networks and members ---

export async function listNetworks(): Promise<CentralNetworkSummary[]> {
  const r = await request<{ networks?: CentralNetworkSummary[] }>('GET', '/networks')
  return r?.networks ?? []
}

export async function listMembers(
  networkId: string,
): Promise<{ members: CentralNetworkMember[]; temporary_peers: TemporaryPeer[] }> {
  const r = await request<{ members?: CentralNetworkMember[]; temporary_peers?: TemporaryPeer[] }>(
    'GET',
    `/networks/${seg(networkId)}/members`,
  )
  return { members: r?.members ?? [], temporary_peers: r?.temporary_peers ?? [] }
}

export async function addMembers(networkId: string, deviceIds: string[]): Promise<void> {
  await request('POST', `/networks/${seg(networkId)}/members`, {
    body: { device_ids: deviceIds, temporary: false },
  })
}

export function updateMember(
  networkId: string,
  deviceId: string,
  patch: MemberPatch,
): Promise<CentralNetworkMember> {
  return request('PATCH', `/networks/${seg(networkId)}/members/${seg(deviceId)}`, { body: patch })
}

export async function removeMember(networkId: string, deviceId: string): Promise<void> {
  await request('DELETE', `/networks/${seg(networkId)}/members/${seg(deviceId)}`)
}

export function getMemberConfig(networkId: string, deviceId: string): Promise<Record<string, unknown>> {
  return request('GET', `/networks/${seg(networkId)}/members/${seg(deviceId)}/config`)
}

export async function setMemberConfig(networkId: string, deviceId: string, config: object): Promise<void> {
  await request('PUT', `/networks/${seg(networkId)}/members/${seg(deviceId)}/config`, { body: { config } })
}

export async function clearMemberConfig(networkId: string, deviceId: string): Promise<void> {
  await request('DELETE', `/networks/${seg(networkId)}/members/${seg(deviceId)}/config`)
}

// --- proxy-rpc ---

/** At most this many proxy-rpc calls are in flight at once, app-wide; the rest wait in FIFO order. */
const RPC_CONCURRENCY = 4
let rpcActive = 0
const rpcWaiters: (() => void)[] = []

async function acquireRpcSlot(): Promise<void> {
  if (rpcActive < RPC_CONCURRENCY) {
    rpcActive++
    return
  }
  await new Promise<void>((resolve) => rpcWaiters.push(resolve))
}

function releaseRpcSlot(): void {
  const next = rpcWaiters.shift()
  // Hand the slot straight to the next waiter so a newcomer cannot slip in between.
  if (next) next()
  else rpcActive--
}

/** A proxy-rpc still unanswered after this long is aborted so it frees its slot. */
export const RPC_TIMEOUT_MS = 8_000

export async function proxyRpc<T>(machineId: string, service: string, method: string, payload: unknown): Promise<T> {
  await acquireRpcSlot()
  // The clock starts once the call holds a slot (queue time does not count). The race guarantees the
  // slot is freed on time even if the transport ignores the abort signal.
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(new ApiError(0, undefined, 'timeout'))
    }, RPC_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      request<T>('POST', `/machines/${seg(machineId)}/proxy-rpc`, {
        body: { service_name: service, method_name: method, payload },
        signal: ctrl.signal,
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
    releaseRpcSlot()
  }
}

const instancePayload = (instId: string) => ({ instance: { id: strToUuid(instId) } })

export async function nodeRoutes(machineId: string, instId: string): Promise<NodeRouteInfo[]> {
  const r = await proxyRpc<{ routes?: NodeRouteInfo[] }>(
    machineId, 'api.instance.PeerManageRpcService', 'list_route', instancePayload(instId))
  return r?.routes ?? []
}

export async function nodePeers(machineId: string, instId: string): Promise<NodePeerInfo[]> {
  const r = await proxyRpc<{ peer_infos?: NodePeerInfo[] }>(
    machineId, 'api.instance.PeerManageRpcService', 'list_peer', instancePayload(instId))
  return r?.peer_infos ?? []
}

export async function nodeAclStats(machineId: string, instId: string): Promise<NodeAclRuleStat[]> {
  const r = await proxyRpc<{ acl_stats?: { rules?: NodeAclRuleStat[] } }>(
    machineId, 'api.instance.AclManageRpcService', 'get_acl_stats', instancePayload(instId))
  return r?.acl_stats?.rules ?? []
}

export async function nodeInfo(
  machineId: string,
  instId: string,
): Promise<{ config: string; interfaceIpv4s: string[] }> {
  const r = await proxyRpc<{
    node_info?: { config?: string; ip_list?: { interface_ipv4s?: { addr?: number }[] } }
  }>(machineId, 'api.instance.PeerManageRpcService', 'show_node_info', instancePayload(instId))
  return {
    config: r?.node_info?.config ?? '',
    interfaceIpv4s: (r?.node_info?.ip_list?.interface_ipv4s ?? [])
      .map((e) => e.addr)
      .filter((a): a is number => a != null)
      .map(ipv4FromU32),
  }
}

const LOG_LEVELS = ['DISABLED', 'ERROR', 'WARNING', 'INFO', 'DEBUG', 'TRACE']

export async function getLoggerLevel(machineId: string): Promise<number> {
  const r = await proxyRpc<{ level?: number | string }>(machineId, 'api.logger.LoggerRpcService', 'get_logger_config', {})
  const level = r?.level ?? 0
  if (typeof level === 'number') return level
  return Math.max(0, LOG_LEVELS.indexOf(level))
}

export async function setLoggerLevel(machineId: string, level: number): Promise<void> {
  await proxyRpc(machineId, 'api.logger.LoggerRpcService', 'set_logger_config', { level })
}
