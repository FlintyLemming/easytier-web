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
  })
})
