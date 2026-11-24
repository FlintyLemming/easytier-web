import { describe, expect, it } from 'vitest'
import indexFx from '../fixtures/v2.7.1/migrate/index.json'
import cfgCore1 from '../fixtures/v2.7.1/migrate/config-core1-office.json'
import cfgCore2 from '../fixtures/v2.7.1/migrate/config-core2-office.json'
import cfgCore3 from '../fixtures/v2.7.1/migrate/config-core3-office.json'
import storedCore2 from '../fixtures/v2.7.1/migrate/stored-core2-office.json'
import storedCore3 from '../fixtures/v2.7.1/migrate/stored-core3-office.json'
import storedCore4 from '../fixtures/v2.7.1/migrate/stored-core4-office.json'
import storedLabOld from '../fixtures/v2.7.1/migrate/stored-core1-lab-old.json'
import type { CentralNetworkMember } from '../../src/api/types'
import { CENTRAL_OWNED_FIELDS } from '../../src/domain/memberOverride'
import { LEGACY_VPN_FIELDS } from '../../src/domain/vpnPortal'
import {
  changeFields, classifyInstance, isUnset, planGroup, targetFromDetail, unconfirmedChanges, type TargetNetwork,
} from '../../src/domain/migration/classify'
import { groupLegacy } from '../../src/domain/migration/inventory'
import type { DeviceRef, LegacyConfig, LegacyInstance } from '../../src/domain/migration/types'

const target: TargetNetwork = {
  networkName: 'office', secret: 'office-secret', method: 'Manual', publicServerUrl: null,
  peerUrls: ['tcp://core1:11010'], virtualCidr: '10.150.0.0/24', secureMode: false,
}
const M = indexFx.machines as Record<string, string>
const ids = indexFx.instances as Record<string, Record<string, string>>
const devices = new Map<string, DeviceRef>(
  Object.entries(M).map(([name, id]) => [id, { id, name, hostname: name, online: true }]),
)
const inst = (name: string, running: boolean, config: object, network = 'office'): LegacyInstance => ({
  deviceId: M[name]!, instanceId: ids[name]?.[network] ?? `${name}-${network}`, networkName: network, running,
  config: config as LegacyConfig,
})
const officeGroup = (over: Partial<Record<string, object>> = {}) =>
  groupLegacy([
    inst('core1', true, over.core1 ?? cfgCore1),
    inst('core2', true, over.core2 ?? cfgCore2),
    inst('core3', true, over.core3 ?? cfgCore3),
    inst('core4', false, over.core4 ?? storedCore4),
  ], devices, [])[0]!
const keys = (o: object) => Object.keys(o).sort()

describe('classifyInstance', () => {
  it('core2: member fields, a lossless override, no changes', () => {
    const plan = classifyInstance(storedCore2, 'core2', target)
    expect(plan.member).toEqual({ virtualIpv4: '10.150.0.2', hostnameOverride: 'core2-office', proxyCidrs: ['192.168.88.0/24'] })
    expect(plan.override.port_forwards).toEqual(storedCore2.port_forwards)
    expect(plan.override.listener_urls).toEqual(storedCore2.listener_urls)
    for (const k of [...CENTRAL_OWNED_FIELDS, 'proxy_cidrs', 'virtual_ipv4', 'hostname']) expect(plan.override).not.toHaveProperty(k)
    for (const [k, v] of Object.entries(plan.override)) expect(isUnset(k, v), k).toBe(false)
    expect(plan.changes).toEqual([])
    expect(plan.legacyAcl).toBeNull()
  })

  it('the running view gives the same plan as the stored copy', () => {
    const a = classifyInstance(cfgCore2, 'core2', target)
    const b = classifyInstance(storedCore2, 'core2', target)
    expect(a.member).toEqual(b.member)
    expect(a.changes.map((c) => c.key)).toEqual(b.changes.map((c) => c.key))
    expect(a.override).toEqual(b.override)
  })

  it('core3: MTU and socks5 go to the override, its ACL is a change', () => {
    const plan = classifyInstance(storedCore3, 'core3', target)
    expect(plan.override).toMatchObject({ mtu: 1300, enable_socks5: true, socks5_port: 1080 })
    expect(plan.changes.map((c) => c.key)).toEqual(['acl'])
    expect(plan.legacyAcl).toEqual(storedCore3.acl)
    expect(plan.member.hostnameOverride).toBeNull()
  })

  it('core1: other servers and the legacy VPN portal are changes; no legacy VPN field in the override', () => {
    const plan = classifyInstance(cfgCore1, 'core1', target)
    expect(keys(plan.changes.map((c) => c.key))).toEqual(keys(['connectivity', 'vpn_portal']))
    const conn = plan.changes.find((c) => c.key === 'connectivity')!
    expect([conn.from, conn.to]).toEqual(['tcp://core2:11010', 'tcp://core1:11010'])
    const vpn = plan.changes.find((c) => c.key === 'vpn_portal')!
    expect(vpn.from).toContain('11013')
    expect(vpn.to).toBe('off')
    for (const f of LEGACY_VPN_FIELDS) expect(plan.override).not.toHaveProperty(f)
  })

  it('legacy VPN fields of a portal that is not enabled are dropped', () => {
    const plan = classifyInstance({ ...cfgCore2, enable_vpn_portal: false, vpn_portal_listen_port: 11013 }, 'core2', target)
    expect(plan.changes.find((c) => c.key === 'vpn_portal')?.to).toBe('dropped')
  })

  it('lab-old (DHCP, Standalone, other name and secret, ACL) against the office network', () => {
    const plan = classifyInstance(storedLabOld, 'core1', target)
    expect(keys(plan.changes.map((c) => c.key))).toEqual(keys(['dhcp', 'network_name', 'network_secret', 'connectivity', 'acl']))
    expect(plan.member.virtualIpv4).toBeNull()
    const secret = plan.changes.find((c) => c.key === 'network_secret')!
    expect(secret.from).not.toContain('lab-old-secret')
    expect(secret.to).not.toContain('office-secret')
  })

  it('a different prefix is a change; a hostname equal to the system one or blank is no override', () => {
    expect(classifyInstance({ ...storedCore2, network_length: 16 }, 'core2', target).changes.map((c) => c.key)).toEqual(['network_length'])
    expect(classifyInstance({ ...storedCore2, hostname: 'core2' }, 'core2', target).member.hostnameOverride).toBeNull()
    expect(classifyInstance({ ...storedCore2, hostname: '' }, 'core2', target).member.hostnameOverride).toBeNull()
  })

  it('a secure-mode network is a change for a device without secure mode', () => {
    expect(classifyInstance(storedCore2, 'core2', { ...target, secureMode: true }).changes.map((c) => c.key)).toEqual(['secure_mode'])
  })
})

describe('planGroup', () => {
  const all = new Set(Object.values(M))
  const blockerKinds = (p: { blockers: { kind: string }[] }) => p.blockers.map((b) => b.kind)

  it('fixed IPs outside the subnet, or its network or broadcast address, block', () => {
    for (const ip of ['10.150.1.5', '10.150.0.0', '10.150.0.255']) {
      const g = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: ip } })
      const p = planGroup(g, devices, target, [], all).find((x) => x.device.name === 'core2')!
      expect(blockerKinds(p), ip).toEqual(['ipOutsideCidr'])
      expect(p.defaultSelected).toBe(false)
    }
  })

  it('two selected devices with one IP both block; with only one selected, the other blocks', () => {
    const g = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.150.0.9' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.9' } })
    const both = planGroup(g, devices, target, [], all)
    expect(blockerKinds(both.find((x) => x.device.name === 'core2')!)).toEqual(['duplicateIp'])
    expect(blockerKinds(both.find((x) => x.device.name === 'core3')!)).toEqual(['duplicateIp'])
    const one = planGroup(g, devices, target, [], new Set([M.core2!]))
    expect(blockerKinds(one.find((x) => x.device.name === 'core2')!)).toEqual([])
    expect(one.find((x) => x.device.name === 'core3')!.blockers).toEqual([{ kind: 'duplicateIp', ip: '10.150.0.9', other: 'core2' }])
  })

  it('a fixed IP an existing member holds blocks; a member device is skipped', () => {
    const members = [
      { device_id: 'other', member_id: 'm1', virtual_ipv4: '10.150.0.3', alias: null, hostname: 'printer' },
      { device_id: M.core2, member_id: 'm2', virtual_ipv4: '10.150.0.2', alias: null, hostname: 'core2' },
    ] as unknown as CentralNetworkMember[]
    const ps = planGroup(officeGroup(), devices, target, members, all)
    const core3 = ps.find((x) => x.device.name === 'core3')!
    expect(core3.blockers).toEqual([{ kind: 'ipTaken', ip: '10.150.0.3', other: 'printer' }])
    const core2 = ps.find((x) => x.device.name === 'core2')!
    expect([core2.alreadyMember, core2.defaultSelected, core2.blockers.length]).toEqual([true, false, 0])
  })

  it('disabled instances are not selected by default; running ones without blockers are', () => {
    const ps = planGroup(officeGroup(), devices, target, [], all)
    expect(ps.map((p) => [p.device.name, p.defaultSelected])).toEqual([
      ['core1', true], ['core2', true], ['core3', true], ['core4', false],
    ])
  })
})

describe('changes', () => {
  it('unconfirmedChanges lists what was not confirmed', () => {
    const plan = classifyInstance({ ...storedCore3, peer_urls: ['tcp://x:1'] }, 'core3', target)
    expect(unconfirmedChanges(plan, new Set(['acl']))).toEqual(['connectivity'])
    expect(unconfirmedChanges(plan, new Set(['acl', 'connectivity']))).toEqual([])
  })

  it('changeFields covers the config fields of a change', () => {
    expect(changeFields('connectivity')).toEqual(['networking_method', 'public_server_url', 'peer_urls', 'peers'])
    expect(changeFields('vpn_portal')).toEqual([...LEGACY_VPN_FIELDS, 'vpn_portal_config'])
    expect(changeFields('dhcp')).toEqual(['dhcp', 'virtual_ipv4'])
    expect(changeFields('acl')).toEqual(['acl'])
  })

  it('a Gateway network targets its gateway address', () => {
    const t = targetFromDetail(
      { network_id: 'n', display_name: 'g', network_name: 'g', networking_method: 'Gateway', member_count: 0,
        network_secret: 's', peer_urls: ['tcp://old:1'], virtual_cidr: null, secure_mode: true },
      { enabled: true, peer_url: 'tcp://gw:22020' },
    )
    expect(t.method).toBe('Gateway')
    expect(t.peerUrls).toEqual(['tcp://gw:22020'])
    expect(t.secureMode).toBe(true)
    expect(t.virtualCidr).toBeNull()
  })
})
