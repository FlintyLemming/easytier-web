import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/v2.7.1/member-config-core3.json'
import { normalizeNetworkConfig, toBackendNetworkConfig, type NetworkConfig } from '../../src/lib/networkConfig'

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
