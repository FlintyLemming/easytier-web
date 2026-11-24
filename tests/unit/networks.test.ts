import { describe, expect, it } from 'vitest'
import networkFx from '../fixtures/v2.7.1/network.json'
import networkSecureFx from '../fixtures/v2.7.1/network-secure.json'
import membersFx from '../fixtures/v2.7.1/members.json'
import membersSecureFx from '../fixtures/v2.7.1/members-secure.json'
import type { CentralNetworkDetail, CentralNetworkMember } from '../../src/api/types'
import {
  credentialJoinCommand, credentialJoinToml, credentialMemberId, memberName, memberRows, normalizeVirtualCidr,
  randomNetworkSecret, settingsErrors, settingsFormFrom, settingsImpacts, settingsPayload, type SettingsForm,
} from '../../src/domain/networks'

const home = networkFx as CentralNetworkDetail
const secure = networkSecureFx as CentralNetworkDetail
const members = membersFx.members as CentralNetworkMember[]

const form = (over: Partial<SettingsForm> = {}): SettingsForm => ({ ...settingsFormFrom(home), ...over })

describe('normalizeVirtualCidr', () => {
  it('trims, adds /24 to a bare address and maps blank to null', () => {
    expect(normalizeVirtualCidr(' 10.1.0.0 ')).toBe('10.1.0.0/24')
    expect(normalizeVirtualCidr('10.1.0.0/16')).toBe('10.1.0.0/16')
    expect(normalizeVirtualCidr('')).toBeNull()
    expect(normalizeVirtualCidr('   ')).toBeNull()
  })
})

describe('settings form', () => {
  it('reads a Manual network into the form', () => {
    const f = settingsFormFrom(home)
    expect(f).toEqual({
      displayName: 'home-central', networkName: 'home-central', method: 'Manual', publicServerUrl: '',
      peerUrls: ['tcp://core1:11010'], virtualCidr: '10.144.144.0/24', secureMode: false,
    })
  })

  it('a Gateway network has no editable peer list; a PublicServer network keeps its URL', () => {
    expect(settingsFormFrom({ ...home, networking_method: 'Gateway', peer_urls: ['tcp://gw:22020'] }).peerUrls).toEqual([])
    const ps = settingsFormFrom({ ...home, networking_method: 'PublicServer', public_server_url: 'tcp://p:1', peer_urls: [] })
    expect(ps.publicServerUrl).toBe('tcp://p:1')
  })

  it('reports required, url, cidr and network name errors', () => {
    expect(settingsErrors(form())).toEqual({})
    expect(settingsErrors(form({ peerUrls: [] }))).toEqual({ peerUrls: 'required' })
    expect(settingsErrors(form({ peerUrls: ['foo'] }))).toEqual({ peerUrls: 'url' })
    expect(settingsErrors(form({ virtualCidr: '10.0.0.300/24' }))).toEqual({ virtualCidr: 'cidr' })
    expect(settingsErrors(form({ displayName: ' ' }))).toEqual({ displayName: 'required' })
    expect(settingsErrors(form({ networkName: 'a b' }))).toEqual({ networkName: 'required' })
    expect(settingsErrors(form({ method: 'PublicServer', publicServerUrl: '' }))).toEqual({ publicServerUrl: 'required' })
    expect(settingsErrors(form({ method: 'PublicServer', publicServerUrl: 'nope' }))).toEqual({ publicServerUrl: 'url' })
    expect(settingsErrors(form({ method: 'PublicServer', publicServerUrl: 'tcp://a:1' }))).toEqual({})
    expect(settingsErrors(form({ method: 'Standalone', peerUrls: [] }))).toEqual({})
    // A blank network-name is fine (the backend generates or keeps one); a bare address is a valid subnet.
    expect(settingsErrors(form({ networkName: '', virtualCidr: '10.5.0.0' }))).toEqual({})
  })

  it('payload for an unchanged form keeps the name (null) and only the method’s addresses', () => {
    expect(settingsPayload(form(), home)).toEqual({
      display_name: 'home-central', network_name: null, networking_method: 'Manual', public_server_url: null,
      peer_urls: ['tcp://core1:11010'], virtual_cidr: '10.144.144.0/24', secure_mode: false,
    })
    expect(settingsPayload(form({ networkName: 'x' }), home).network_name).toBe('x')
    const sa = settingsPayload(form({ method: 'Standalone' }), home)
    expect(sa.peer_urls).toEqual([])
    expect(sa.public_server_url).toBeNull()
    const ps = settingsPayload(form({ method: 'PublicServer', publicServerUrl: ' tcp://p:1 ' }), home)
    expect(ps.public_server_url).toBe('tcp://p:1')
    expect(ps.peer_urls).toEqual([])
    expect(settingsPayload(form({ method: 'Gateway' }), home).peer_urls).toEqual([])
  })

  it('payload for a new network: blank name is null, subnet normalized, display name trimmed', () => {
    const f: SettingsForm = {
      displayName: ' Lab ', networkName: '  ', method: 'Manual', publicServerUrl: '',
      peerUrls: ['tcp://1.2.3.4:11010'], virtualCidr: '10.9.0.0', secureMode: true,
    }
    expect(settingsPayload(f)).toEqual({
      display_name: 'Lab', network_name: null, networking_method: 'Manual', public_server_url: null,
      peer_urls: ['tcp://1.2.3.4:11010'], virtual_cidr: '10.9.0.0/24', secure_mode: true,
    })
    expect(settingsPayload({ ...f, networkName: ' lab ' }).network_name).toBe('lab')
  })

  it('lists the impacts of a change', () => {
    expect(settingsImpacts(form({ displayName: 'Home' }), home)).toEqual([])
    expect(settingsImpacts(form({ virtualCidr: '10.150.0.0/24' }), home)).toEqual(['virtualCidr'])
    expect(settingsImpacts(form({ virtualCidr: '10.144.144.0' }), home)).toEqual([])
    expect(settingsImpacts(form({ peerUrls: ['tcp://x:1'] }), home)).toEqual(['method'])
    expect(settingsImpacts(form({ method: 'Standalone' }), home)).toEqual(['method'])
    expect(settingsImpacts(form({ networkName: 'n2', secureMode: true }), home)).toEqual(['networkName', 'secureMode'])
    // A Gateway network kept as Gateway has no address change.
    const gw = { ...home, networking_method: 'Gateway' as const, peer_urls: ['tcp://gw:22020'] }
    expect(settingsImpacts(settingsFormFrom(gw), gw)).toEqual([])
  })
})

describe('randomNetworkSecret', () => {
  it('is 32 random bytes in base64', () => {
    const a = randomNetworkSecret()
    expect(a).toHaveLength(44)
    expect(atob(a)).toHaveLength(32)
    expect(randomNetworkSecret()).not.toBe(a)
  })
})

describe('member rows', () => {
  const m = (over: Partial<CentralNetworkMember>): CentralNetworkMember => ({ ...members[1]!, ...over })

  it('names members by alias, hostname override, hostname, then id', () => {
    expect(memberName(m({ alias: 'A', hostname_override: 'H', hostname: 'h' }))).toBe('A')
    expect(memberName(m({ alias: null, hostname_override: 'H', hostname: 'h' }))).toBe('H')
    expect(memberName(m({ alias: null, hostname_override: null, hostname: 'h' }))).toBe('h')
    expect(memberName(m({ alias: null, hostname_override: null, hostname: null }))).toBe('22222222')
  })

  it('fixed and auto IPs', () => {
    const rows = memberRows(members)
    expect(rows.find((r) => r.name === 'core1')).toMatchObject({ ipKind: 'fixed', ip: '10.144.144.1' })
    expect(rows.find((r) => r.name === 'core2')).toMatchObject({ ipKind: 'auto', ip: '10.144.144.2' })
    expect(memberRows([m({ virtual_ipv4: null, allocated_ipv4: null, runtime_virtual_ipv4: null })])[0]).toMatchObject({ ipKind: 'none', ip: null })
  })

  it('derives the five states', () => {
    const state = (over: Partial<CentralNetworkMember>) => memberRows([m(over)])[0]!.state
    expect(state({ online: false, running: null })).toBe('offline')
    expect(state({ online: true, error_msg: 'boom', running: false })).toBe('error')
    expect(state({ online: true, running: true })).toBe('running')
    expect(state({ online: true, running: false })).toBe('stopped')
    expect(state({ online: true, running: null })).toBe('starting')
    expect(memberRows([m({ error_msg: 'boom' })])[0]!.errorMsg).toBe('boom')
  })

  it('marks temporary members with their expiry, and sorts online first then by name', () => {
    const [t] = memberRows(membersSecureFx.members as CentralNetworkMember[])
    expect(t).toMatchObject({ temporary: true, expiryUnix: membersSecureFx.members[0]!.credential_expiry_unix })
    const rows = memberRows([m({ hostname: 'b', device_id: 'b' }), m({ hostname: 'z', device_id: 'z', online: false }), m({ hostname: 'a', device_id: 'a' })])
    expect(rows.map((r) => r.name)).toEqual(['a', 'b', 'z'])
  })
})

describe('credentials', () => {
  it('maps a member credential id to its member id', () => {
    expect(credentialMemberId('member-abc')).toBe('abc')
    expect(credentialMemberId('fixture-cred')).toBeNull()
  })

  it('builds the CLI join command', () => {
    expect(credentialJoinCommand(secure, null, 'S')).toBe('easytier-core --network-name fixture-secure --secure-mode --credential S')
    expect(credentialJoinCommand(home, null, 'S')).toBe('easytier-core --network-name home-central --secure-mode --credential S -p tcp://core1:11010')
    const gw = { ...home, networking_method: 'Gateway' as const, peer_urls: ['tcp://stale:1'] }
    expect(credentialJoinCommand(gw, { enabled: true, peer_url: 'tcp://gw:22020' }, 'S')).toContain('-p tcp://gw:22020')
    const ps = { ...home, networking_method: 'PublicServer' as const, public_server_url: 'tcp://pub:11010', peer_urls: [] }
    expect(credentialJoinCommand(ps, null, 'S')).toContain('-p tcp://pub:11010')
  })

  it('builds the TOML join snippet, without a peer section when there is no peer, escaping quotes', () => {
    expect(credentialJoinToml(secure, null, 'S')).toBe(
      '[network_identity]\nnetwork_name = "fixture-secure"\n\n[secure_mode]\nenabled = true\nlocal_private_key = "S"',
    )
    expect(credentialJoinToml(home, null, 'S')).toBe(
      '[network_identity]\nnetwork_name = "home-central"\n\n[[peer]]\nuri = "tcp://core1:11010"\n\n[secure_mode]\nenabled = true\nlocal_private_key = "S"',
    )
    expect(credentialJoinToml({ ...secure, network_name: 'a"b\\c' }, null, 'S')).toContain('network_name = "a\\"b\\\\c"')
  })
})
