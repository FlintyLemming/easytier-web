import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/v2.7.1/member-config-core3.json'
import instanceConfig from '../fixtures/v2.7.1/instance-config-core2.json'
import { declaredDefault, isDefaultValue, normalizeNetworkConfig, toBackendNetworkConfig, type NetworkConfig } from '../../src/lib/networkConfig'

describe('networkConfig round trip', () => {
  it('round trip keeps fields the form never shows', () => {
    const input = {
      ...fixture,
      routes: ['10.9.0.0/16'],
      port_forwards: [
        { bind_ip: '0.0.0.0', bind_port: 8080, dst_ip: '10.144.144.2', dst_port: 80, proto: 'tcp' },
      ],
      relay_network_whitelist: ['a', 'b'],
    }
    const out = toBackendNetworkConfig(normalizeNetworkConfig(input as unknown as NetworkConfig)) as unknown as Record<string, unknown>

    expect(out.proxy_cidrs).toEqual(input.proxy_cidrs)
    expect(out.routes).toEqual(input.routes)
    expect(out.port_forwards).toEqual(input.port_forwards)
    expect(out.relay_network_whitelist).toEqual(input.relay_network_whitelist)
  })
})

describe('isDefaultValue / declaredDefault', () => {
  it('treats declared defaults and empty values as default', () => {
    expect(isDefaultValue('mtu', 1380)).toBe(true)
    expect(isDefaultValue('multi_thread', true)).toBe(true)
    expect(isDefaultValue('disable_encryption', false)).toBe(true)
    expect(isDefaultValue('encryption_algorithm', 'aes-gcm')).toBe(true)
    expect(isDefaultValue('data_compress_algo', 'None')).toBe(true)
    expect(isDefaultValue('latency_first', undefined)).toBe(true)
    expect(isDefaultValue('routes', [])).toBe(true)
    expect(isDefaultValue('dev_name', '')).toBe(true)
  })

  it('treats anything else as a real value', () => {
    expect(isDefaultValue('mtu', 1300)).toBe(false)
    expect(isDefaultValue('multi_thread', false)).toBe(false)
    expect(isDefaultValue('routes', ['10.0.0.0/8'])).toBe(false)
  })

  it('declaredDefault reads the annotation', () => {
    expect(declaredDefault('mtu')).toBe('1380')
    expect(declaredDefault('multi_thread')).toBe(true)
    expect(declaredDefault('disable_encryption')).toBe(false)
    expect(declaredDefault('network_name')).toBeUndefined()
  })
})

describe('instance-config-core2 round trip', () => {
  it('keeps every field the form does not show', () => {
    const input = instanceConfig as Record<string, unknown>
    const normalized = normalizeNetworkConfig(input as unknown as NetworkConfig)
    normalized.mtu = 1300
    const out = toBackendNetworkConfig(normalized) as unknown as Record<string, unknown>

    expect(out.mtu).toBe(1300)
    for (const key of [
      'routes', 'exit_nodes', 'acl', 'dns', 'socks5_port', 'enable_socks5', 'mapped_listeners',
      'relay_network_whitelist', 'port_forwards',
      // 2.6.x cores only understand the legacy VPN portal fields.
      'enable_vpn_portal', 'vpn_portal_listen_port', 'vpn_portal_client_network_addr', 'vpn_portal_client_network_len',
    ]) {
      expect(out[key], key).toEqual(input[key])
    }
    // Nothing else changes, and nothing is added (the fixture has no public_server_url).
    expect(out).toEqual({ ...input, mtu: 1300 })
    expect('public_server_url' in out).toBe(false)
  })
})

describe('networking method', () => {
  const backend = (config: Record<string, unknown>) =>
    toBackendNetworkConfig(normalizeNetworkConfig(config as unknown as NetworkConfig)) as unknown as Record<string, unknown>

  it('keeps public_server_url as read for a manual config', () => {
    const base = { network_name: 'n', networking_method: 'Manual', peer_urls: ['tcp://10.0.0.1:11010'] }
    expect('public_server_url' in backend(base)).toBe(false)
    expect(backend({ ...base, public_server_url: '' }).public_server_url).toBe('')
    expect(backend({ ...base, public_server_url: 'tcp://stale:11010' }).public_server_url).toBe('tcp://stale:11010')
    expect(backend(base).networking_method).toBe('Manual')
    expect(backend(base).peer_urls).toEqual(['tcp://10.0.0.1:11010'])
  })

  it('turns a public-server config into a manual one that peers with the server', () => {
    const out = backend({ network_name: 'n', networking_method: 'PublicServer', public_server_url: 'tcp://public.easytier.top:11010' })
    expect(out.networking_method).toBe('Manual')
    expect(out.peer_urls).toEqual(['tcp://public.easytier.top:11010'])
    expect(out.public_server_url).toBe('')
  })

  it('turns a standalone config into a manual one without peers', () => {
    const out = backend({ network_name: 'n', networking_method: 'Standalone', peer_urls: ['tcp://10.0.0.1:11010'] })
    expect(out.networking_method).toBe('Manual')
    expect(out.peer_urls ?? []).toEqual([])
    expect('public_server_url' in out).toBe(false)
  })

  it('always carries networking_method, which generate-config needs', () => {
    expect(backend({ network_name: 'n' }).networking_method).toBe('Manual')
  })
})
