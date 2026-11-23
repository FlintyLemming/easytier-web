import { describe, expect, it } from 'vitest'
import cfg from '../fixtures/v2.7.1/member-config-core3.json'
import { CENTRAL_OWNED_FIELDS, overrideState, resetOverridePlan } from '../../src/domain/memberOverride'

describe('CENTRAL_OWNED_FIELDS', () => {
  it('matches apply_member_override in central_network/compiler.rs', () => {
    expect([...CENTRAL_OWNED_FIELDS]).toEqual([
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
  })
})

describe('overrideState', () => {
  it('fixture with only PATCHed proxy_cidrs is default', () => {
    expect(overrideState(cfg)).toBe('default')
  })

  it('an extra real field makes it overridden', () => {
    expect(overrideState({ ...cfg, mtu: 1300 })).toBe('overridden')
  })

  it('central-owned fields never count', () => {
    expect(overrideState({ ...cfg, hostname: 'x', acl: { acl_v1: { chains: [{ name: 'inbound' }] } } })).toBe('default')
  })

  it('empty values do not count', () => {
    expect(overrideState({ mtu: null, listeners: [], dev_name: '', foo: undefined })).toBe('default')
  })

  it('false and 0 are real values', () => {
    expect(overrideState({ latency_first: false })).toBe('overridden')
    expect(overrideState({ mtu: 0 })).toBe('overridden')
  })

  it('null / undefined config is default', () => {
    expect(overrideState(null)).toBe('default')
    expect(overrideState(undefined)).toBe('default')
  })
})

describe('resetOverridePlan', () => {
  it('keeps proxy_cidrs with a PUT', () => {
    expect(resetOverridePlan(cfg)).toEqual({ kind: 'put', config: { proxy_cidrs: ['192.168.77.0/24'] } })
  })

  it('PUT drops every other field', () => {
    expect(resetOverridePlan({ ...cfg, mtu: 1300, hostname: 'x' })).toEqual({
      kind: 'put',
      config: { proxy_cidrs: ['192.168.77.0/24'] },
    })
  })

  it('deletes when there are no proxy_cidrs', () => {
    expect(resetOverridePlan(null)).toEqual({ kind: 'delete' })
    expect(resetOverridePlan(undefined)).toEqual({ kind: 'delete' })
    expect(resetOverridePlan({ proxy_cidrs: [] })).toEqual({ kind: 'delete' })
    expect(resetOverridePlan({ mtu: 1300 })).toEqual({ kind: 'delete' })
  })

  it('ignores a malformed proxy_cidrs value', () => {
    expect(resetOverridePlan({ proxy_cidrs: 'nope' })).toEqual({ kind: 'delete' })
  })
})
