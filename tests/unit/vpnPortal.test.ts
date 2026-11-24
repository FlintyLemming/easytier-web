import { describe, expect, it } from 'vitest'
import coreInfo from '../fixtures/v2.7.1/instance-info-core2.json'
import portal from '../fixtures/v2.7.1/vpn-portal-info-core2.json'
import instanceConfig from '../fixtures/v2.7.1/instance-config-core2.json'
import type { InstanceRunningInfo } from '../../src/api/types'
import {
  createVpnPortalConfig,
  LEGACY_VPN_FIELDS,
  normalizeVpnPortalEndpoint,
  splitLegacyVpn,
  suggestVpnPortalAddress,
  usesLegacyVpn,
  validVpnClientName,
  validVpnPortalAddress,
  vpnPortalClientConfig,
  vpnPortalEndpoint,
  vpnPortalUsedIps,
} from '../../src/domain/vpnPortal'

const ip = (a: number, b: number, c: number, d: number) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
const info = (extra: Record<string, unknown> = {}): InstanceRunningInfo => ({
  running: true,
  my_node_info: { virtual_ipv4: { address: { addr: ip(10, 144, 144, 3) }, network_length: 24 } },
  ...extra,
})
const fixtureInfo = (coreInfo.info.map as Record<string, unknown>)['5eed0000-0000-4000-8000-000000000001'] as InstanceRunningInfo

describe('createVpnPortalConfig', () => {
  it('makes a clamped 32 byte key', () => {
    const cfg = createVpnPortalConfig()
    const key = Uint8Array.from(atob(cfg.wireguard_private_key ?? ''), (c) => c.charCodeAt(0))
    expect(key.length).toBe(32)
    expect(key[0]! & 7).toBe(0)
    expect(key[31]! & 192).toBe(64)
    expect(cfg.wireguard_listen).toBe('0.0.0.0:22022')
    expect(cfg.clients).toEqual([])
  })
})

describe('address helpers', () => {
  it('suggests the first free host of the instance network', () => {
    const clients = [{ virtual_ip: '10.144.144.20/24' }]
    const used = vpnPortalUsedIps(info(), clients)
    expect(used.has(ip(10, 144, 144, 3))).toBe(true)
    expect(used.has(ip(10, 144, 144, 20))).toBe(true)
    expect(suggestVpnPortalAddress(info(), clients, used)).toEqual({ address: '10.144.144.1', prefix: 24 })
  })

  it('collects peer route addresses', () => {
    const peers = info({ peer_route_pairs: [{ route: { ipv4_addr: { address: { addr: ip(10, 144, 144, 1) }, network_length: 24 } } }] })
    expect(vpnPortalUsedIps(peers, []).has(ip(10, 144, 144, 1))).toBe(true)
    expect(suggestVpnPortalAddress(peers, [], vpnPortalUsedIps(peers, []))).toEqual({ address: '10.144.144.2', prefix: 24 })
  })

  it('has no suggestion without an address', () => {
    expect(suggestVpnPortalAddress(null, [], new Set())).toEqual({ address: '' })
  })

  it('validates addresses', () => {
    const used = new Set([ip(10, 144, 144, 3)])
    expect(validVpnPortalAddress('10.144.144.20', 24, used)).toBe(true)
    expect(validVpnPortalAddress('10.144.144.0', 24, used)).toBe(false)
    expect(validVpnPortalAddress('10.144.144.255', 24, used)).toBe(false)
    expect(validVpnPortalAddress('10.144.144.3', 24, used)).toBe(false)
    expect(validVpnPortalAddress('192.168.1.5', 24, used)).toBe(true) // inside its own /24 only
    expect(validVpnPortalAddress('192.168.1.5', 24, used, '10.144.144.0/24')).toBe(false)
    expect(validVpnPortalAddress('10.144.144.20', 24, used, '10.144.144.0/24')).toBe(true)
    expect(validVpnPortalAddress('10.144.144.20', undefined, used)).toBe(false)
    expect(validVpnPortalAddress('nope', 24, used)).toBe(false)
  })

  it('validates client names', () => {
    expect(validVpnClientName('phone-1')).toBe(true)
    expect(validVpnClientName('-x')).toBe(false)
    expect(validVpnClientName('')).toBe(false)
    expect(validVpnClientName('a'.repeat(64))).toBe(false)
  })
})

describe('endpoint', () => {
  it('uses the public ipv4 for a wildcard listener', () => {
    expect(vpnPortalEndpoint('0.0.0.0:22022', fixtureInfo)).toBe('203.0.113.10:22022')
    expect(vpnPortalEndpoint('wg://0.0.0.0:22022', fixtureInfo)).toBe('203.0.113.10:22022')
  })

  it('keeps an explicit host and falls back to empty', () => {
    expect(vpnPortalEndpoint('1.2.3.4:5', null)).toBe('1.2.3.4:5')
    expect(vpnPortalEndpoint('0.0.0.0:22022', null)).toBe('')
    expect(vpnPortalEndpoint('0.0.0.0:0', fixtureInfo)).toBe('')
  })

  it('normalizes a user typed endpoint', () => {
    expect(normalizeVpnPortalEndpoint('vpn.example.com', '22022')).toBe('vpn.example.com:22022')
    expect(normalizeVpnPortalEndpoint('vpn.example.com:99', '22022')).toBe('vpn.example.com:99')
    expect(normalizeVpnPortalEndpoint('0.0.0.0', '22022')).toBe('')
    expect(normalizeVpnPortalEndpoint('a b', '22022')).toBe('')
    expect(normalizeVpnPortalEndpoint('x', '70000')).toBe('')
  })

  it('replaces the Endpoint line of a v2.7 template', () => {
    const cfg = '[Peer]\nEndpoint = 0.0.0.0:22022\nPersistentKeepalive = 25\n'
    expect(vpnPortalClientConfig(cfg, '203.0.113.10:22022')).toBe('[Peer]\nEndpoint = 203.0.113.10:22022\nPersistentKeepalive = 25\n')
    expect(vpnPortalClientConfig('', 'x')).toBe('')
  })

  it('replaces the whole legacy Endpoint line, comment included', () => {
    const out = vpnPortalClientConfig(portal.vpn_portal_info.client_config, '203.0.113.10:22022')
    expect(out).toContain('\nEndpoint = 203.0.113.10:22022\n')
    expect(out).not.toContain('should be the public ip')
  })

  it('takes `$` in the endpoint literally', () => {
    const cfg = '[Peer]\nEndpoint = 0.0.0.0:22022\n'
    expect(vpnPortalClientConfig(cfg, 'vpn$&.example.com:22022')).toBe('[Peer]\nEndpoint = vpn$&.example.com:22022\n')
    expect(vpnPortalClientConfig(cfg, 'a$1$$b:22022')).toBe('[Peer]\nEndpoint = a$1$$b:22022\n')
  })
})

describe('legacy vpn fields', () => {
  it('lists the four legacy fields', () => {
    expect([...LEGACY_VPN_FIELDS]).toEqual(['enable_vpn_portal', 'vpn_portal_listen_port', 'vpn_portal_client_network_addr', 'vpn_portal_client_network_len'])
  })

  it('splitLegacyVpn separates without mutating', () => {
    const input = { mtu: 1380, enable_vpn_portal: true, vpn_portal_listen_port: 22022 }
    const { rest, legacy } = splitLegacyVpn(input)
    expect(legacy).toEqual({ enable_vpn_portal: true, vpn_portal_listen_port: 22022 })
    expect(rest).toEqual({ mtu: 1380 })
    expect(input).toEqual({ mtu: 1380, enable_vpn_portal: true, vpn_portal_listen_port: 22022 })
    expect(splitLegacyVpn({ a: 1, enable_vpn_portal: undefined }).legacy).toEqual({})
  })

  it('splits the core2 fixture', () => {
    const { rest, legacy } = splitLegacyVpn(instanceConfig as Record<string, unknown>)
    expect(Object.keys(legacy).sort()).toEqual([...LEGACY_VPN_FIELDS].sort())
    for (const k of LEGACY_VPN_FIELDS) expect(rest).not.toHaveProperty(k)
  })

  it('usesLegacyVpn', () => {
    expect(usesLegacyVpn('2.6.4-8428a89d')).toBe(true)
    expect(usesLegacyVpn('2.7.1')).toBe(false)
    expect(usesLegacyVpn('2.7.1', {})).toBe(false)
    expect(usesLegacyVpn('2.7.1', { enable_vpn_portal: true })).toBe(true)
    expect(usesLegacyVpn('weird', {})).toBe(false)
    expect(usesLegacyVpn('weird', { vpn_portal_listen_port: 1 })).toBe(true)
    expect(usesLegacyVpn('2.7.1', { enable_vpn_portal: undefined })).toBe(false)
  })
})
