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
  changeFields, classifyInstance, initialAutoIp, initialChoices, isUnset, planGroup, readyToRun, reconcileIpConfirmations, selectedPreviews,
  targetFromDetail, unconfirmedChanges,
  type TargetNetwork,
} from '../../src/domain/migration/classify'
import { groupLegacy } from '../../src/domain/migration/inventory'
import type { DeviceRef, LegacyConfig, LegacyInstance } from '../../src/domain/migration/types'
import type { ChangeKey } from '../../src/domain/migration/classify'

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

describe('auto-selected addresses (shared fixed IPs)', () => {
  const all = new Set(Object.values(M))
  const byName = (ps: { device: { name: string } }[], n: string) => ps.find((x) => x.device.name === n)! as ReturnType<typeof planGroup>[number]

  it('classifyInstance with a new address: it is the member IP and a fixed_ip change', () => {
    const plan = classifyInstance(cfgCore2, 'core2', target, { newIp: '10.150.0.20' })
    expect(plan.member.virtualIpv4).toBe('10.150.0.20')
    expect(plan.changes).toContainEqual({ key: 'fixed_ip', from: '10.150.0.2', to: '10.150.0.20' })
  })

  it('an auto device gets the highest address no legacy instance, member or earlier pick uses; nobody is blocked', () => {
    const g = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.150.0.9' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.9' } })
    const ps = planGroup(g, devices, target, [], all, new Set([M.core3!]))
    const core3 = byName(ps, 'core3')
    // From the top down, away from sequentially numbered legacy addresses.
    expect(core3.newIp).toBe('10.150.0.254')
    expect(core3.plan.member.virtualIpv4).toBe('10.150.0.254')
    expect(core3.plan.changes.map((c) => c.key)).toContain('fixed_ip')
    expect(core3.blockers).toEqual([])
    expect(byName(ps, 'core2').blockers).toEqual([])
    expect([core3.ipSwitchable, byName(ps, 'core1').ipSwitchable]).toEqual([true, false])
  })

  it('picks skip member addresses (fixed, allocated, runtime) and each other, in name order', () => {
    const g = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.150.0.1' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.1' } })
    const members = [
      { device_id: 'x', member_id: 'm1', virtual_ipv4: null, allocated_ipv4: '10.150.0.254', runtime_virtual_ipv4: null, alias: null, hostname: 'x' },
      { device_id: 'y', member_id: 'm2', virtual_ipv4: null, allocated_ipv4: null, runtime_virtual_ipv4: '10.150.0.253/24', alias: null, hostname: 'y' },
    ] as unknown as CentralNetworkMember[]
    const ps = planGroup(g, devices, target, members, all, new Set([M.core2!, M.core3!]))
    // .254 and .253 are members' → core2 .252, core3 .251
    expect([byName(ps, 'core2').newIp, byName(ps, 'core3').newIp]).toEqual(['10.150.0.252', '10.150.0.251'])
  })

  it('picks also skip addresses seen in the live network (offline or unread devices, unmanaged nodes)', () => {
    const g = officeGroup({ core3: { ...cfgCore3, virtual_ipv4: '10.150.0.2' } })
    const ps = planGroup(g, devices, target, [], all, new Set([M.core3!]), new Set(['10.150.0.254', '10.150.0.253']))
    expect(byName(ps, 'core3').newIp).toBe('10.150.0.252')
  })

  it('no free address in the subnet blocks', () => {
    const small = { ...target, virtualCidr: '10.150.0.0/30' }
    const g = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.150.0.1' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.2' } })
    const ps = planGroup(g, devices, small, [], all, new Set([M.core3!]))
    expect(byName(ps, 'core3').blockers).toEqual([{ kind: 'noFreeIp', cidr: '10.150.0.0/30' }])
    expect(byName(ps, 'core3').newIp).toBeNull()
  })

  it('initialAutoIp: later devices of a shared address and addresses members hold; not outside the subnet, not disabled ones', () => {
    const shared = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.150.0.9' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.9' }, core4: { ...storedCore4, virtual_ipv4: '10.150.0.9' } })
    expect([...initialAutoIp(shared, devices, target, [])]).toEqual([M.core3])
    const taken = [{ device_id: 'other', member_id: 'm1', virtual_ipv4: '10.150.0.3', alias: null, hostname: 'printer' }] as unknown as CentralNetworkMember[]
    expect([...initialAutoIp(officeGroup(), devices, target, taken)]).toEqual([M.core3])
    const outside = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.151.0.2' } })
    expect([...initialAutoIp(outside, devices, target, [])]).toEqual([])
  })

  it('with the initial choices the shared-address devices are selected by default and ready once confirmed', () => {
    const g = officeGroup({ core2: { ...cfgCore2, virtual_ipv4: '10.150.0.9' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.9' } })
    const auto = initialAutoIp(g, devices, target, [])
    const ps = planGroup(g, devices, target, [], all, auto)
    expect(ps.map((p) => [p.device.name, p.defaultSelected])).toEqual([['core1', true], ['core2', true], ['core3', true], ['core4', false]])
  })
})

describe('reconcileIpConfirmations: a confirmed new address that changes must be confirmed again', () => {
  const all = new Set(Object.values(M))
  it('keeps the confirmation while the address stays, drops it when the address moves or the device keeps its own', () => {
    const g = officeGroup({ core1: { ...cfgCore1, virtual_ipv4: '10.150.1.1' }, core3: { ...cfgCore3, virtual_ipv4: '10.150.0.2' } })
    const before = planGroup(g, devices, target, [], all, new Set([M.core3!]))
    const confirmed = { [M.core3!]: ['fixed_ip', 'acl'] as ChangeKey[] }
    const first = reconcileIpConfirmations(before, confirmed, {})
    expect(first.confirmed).toEqual(confirmed)
    expect(first.confirmedIps).toEqual({ [M.core3!]: '10.150.0.254' })
    // core1 (earlier by name) switches to auto and takes .254: core3 moves to .253
    const after = planGroup(g, devices, target, [], all, new Set([M.core1!, M.core3!]))
    const second = reconcileIpConfirmations(after, first.confirmed, first.confirmedIps)
    expect(second.confirmed[M.core3!]).toEqual(['acl'])
    expect(second.confirmedIps).toEqual({})
    // nothing changed: the same objects come back
    const again = reconcileIpConfirmations(before, first.confirmed, first.confirmedIps)
    expect(again.confirmed).toBe(first.confirmed)
  })
})

describe('a device with two instances in one group (seen once in production)', () => {
  const all = new Set(Object.values(M))
  const twice = () =>
    groupLegacy([
      inst('core1', true, cfgCore1),
      { ...inst('core2', false, { ...storedCore2, virtual_ipv4: '10.150.0.12' }), instanceId: 'core2-second' },
      inst('core2', true, cfgCore2),
      inst('core3', true, cfgCore3),
    ], devices, [])[0]!

  it('the running instance is the one that migrates; the other is blocked and gets no address', () => {
    const ps = planGroup(twice(), devices, target, [], all, new Set([M.core2!]))
    const second = ps.find((p) => p.instance.instanceId === 'core2-second')!
    const first = ps.find((p) => p.device.name === 'core2' && p.instance.instanceId !== 'core2-second')!
    expect(second.blockers).toEqual([{ kind: 'otherInstance', instance: first.instance.instanceId }])
    expect([second.defaultSelected, second.newIp, second.ipSwitchable]).toEqual([false, null, false])
    expect(first.blockers.some((b) => b.kind === 'otherInstance')).toBe(false)
  })

  it('initialChoices: the device is chosen when its migrating instance is, whatever the order', () => {
    const ps = planGroup(twice(), devices, target, [], all)
    expect(initialChoices(ps)[M.core2!]).toBe(true)
    expect(selectedPreviews(ps, initialChoices(ps)).filter((p) => p.device.name === 'core2')).toHaveLength(1)
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

describe('selection', () => {
  const all = new Set(Object.values(M))
  const choices = (o: Record<string, boolean>) => Object.fromEntries(Object.entries(o).map(([n, v]) => [M[n]!, v]))

  it('selectedPreviews: chosen, not blocked, not already a member', () => {
    const ps = planGroup(officeGroup({ core3: { ...cfgCore3, virtual_ipv4: '10.150.9.9' } }), devices, target, [], all)
    const sel = selectedPreviews(ps, choices({ core1: true, core2: true, core3: true, core4: false }))
    expect(sel.map((p) => p.device.name)).toEqual(['core1', 'core2'])
  })

  it('readyToRun: something selected, every change of the selected confirmed, no chosen device with a duplicate IP', () => {
    const ps = planGroup(officeGroup(), devices, target, [], all)
    const ch = choices({ core1: true, core2: true, core3: true, core4: false })
    expect(readyToRun(ps, ch, {})).toBe(false)
    const conf = { [M.core1!]: ['connectivity', 'vpn_portal'], [M.core3!]: ['acl'] } as Record<string, ChangeKey[]>
    expect(readyToRun(ps, ch, conf)).toBe(true)
    expect(readyToRun(ps, choices({ core1: false, core2: false, core3: false, core4: false }), conf)).toBe(false)

    const dupSel = new Set([M.core2!, M.core3!])
    const dup = planGroup(officeGroup({ core3: { ...cfgCore3, virtual_ipv4: '10.150.0.2' } }), devices, target, [], dupSel)
    expect(readyToRun(dup, choices({ core1: false, core2: true, core3: true, core4: false }), conf)).toBe(false)
  })
})
