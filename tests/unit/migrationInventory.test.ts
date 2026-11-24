import { describe, expect, it } from 'vitest'
import machinesFx from '../fixtures/v2.7.1/migrate/machines.json'
import indexFx from '../fixtures/v2.7.1/migrate/index.json'
import cfgCore1 from '../fixtures/v2.7.1/migrate/config-core1-office.json'
import cfgCore2 from '../fixtures/v2.7.1/migrate/config-core2-office.json'
import cfgCore3 from '../fixtures/v2.7.1/migrate/config-core3-office.json'
import storedCore4 from '../fixtures/v2.7.1/migrate/stored-core4-office.json'
import storedLabOld from '../fixtures/v2.7.1/migrate/stored-core1-lab-old.json'
import type { CentralNetworkSummary, RawMachine } from '../../src/api/types'
import {
  draftFromGroup, effectivePeers, groupLegacy, isLegacyId, runningLegacyIds, subnetOf,
} from '../../src/domain/migration/inventory'
import type { DeviceRef, LegacyConfig, LegacyGroup, LegacyInstance } from '../../src/domain/migration/types'

const machines = machinesFx.machines as RawMachine[]
const ids = indexFx.instances as Record<string, Record<string, string>>
const M = indexFx.machines as Record<string, string>

const devices = new Map<string, DeviceRef>(
  Object.entries(M).map(([name, id]) => [id, { id, name, hostname: name, online: true }]),
)
const inst = (name: string, network: string, running: boolean, config: object): LegacyInstance => ({
  deviceId: M[name]!, instanceId: ids[name]![network]!, networkName: network, running, config: config as LegacyConfig,
})
const all: LegacyInstance[] = [
  inst('core3', 'office', true, cfgCore3),
  inst('core1', 'office', true, cfgCore1),
  inst('core1', 'lab-old', false, storedLabOld),
  inst('core2', 'office', true, cfgCore2),
  inst('core4', 'office', false, storedCore4),
]
const net = (over: Partial<CentralNetworkSummary>): CentralNetworkSummary => ({
  network_id: 'n1', display_name: 'x', network_name: 'x', networking_method: 'Manual', member_count: 0, online_member_count: 0, ...over,
})
const office = (): LegacyGroup => groupLegacy(all, devices, []).find((g) => g.networkName === 'office')!

describe('legacy ids', () => {
  it('an instance id that is no central network id is legacy', () => {
    expect(isLegacyId('a', [net({ network_id: 'b' })])).toBe(true)
    expect(isLegacyId('b', [net({ network_id: 'b' })])).toBe(false)
  })

  it('runningLegacyIds reads the heartbeats of online devices', () => {
    const office3 = [ids.core1!.office!, ids.core2!.office!, ids.core3!.office!].sort()
    expect(runningLegacyIds(machines, [])).toEqual(office3)
    const central = net({ network_id: ids.core1!.office! })
    expect(runningLegacyIds(machines, [central])).toEqual(office3.filter((i) => i !== ids.core1!.office))
    const offline = machines.map((m) => (m.info && m === machines[0] ? { ...m, online: false } : m))
    expect(runningLegacyIds(offline, []).length).toBe(2)
  })
})

describe('groupLegacy', () => {
  it('groups by network name, sorted, with running and disabled counts', () => {
    const groups = groupLegacy(all, devices, [])
    expect(groups.map((g) => g.networkName)).toEqual(['lab-old', 'office'])
    const [lab, off] = groups as [LegacyGroup, LegacyGroup]
    expect([lab.instances.length, lab.runningCount, lab.disabledCount]).toEqual([1, 0, 1])
    expect([off.instances.length, off.runningCount, off.disabledCount]).toEqual([4, 3, 1])
    expect(off.instances.map((i) => devices.get(i.deviceId)!.name)).toEqual(['core1', 'core2', 'core3', 'core4'])
    expect(off.targetNetworkId).toBeNull()
  })

  it('a central network with the same network name is the target', () => {
    const groups = groupLegacy(all, devices, [net({ network_id: 'c1', network_name: 'office' })])
    expect(groups.find((g) => g.networkName === 'office')!.targetNetworkId).toBe('c1')
  })
})

describe('effectivePeers', () => {
  it('maps every networking method to the addresses it connects to', () => {
    expect(effectivePeers({ networking_method: 0, public_server_url: 'tcp://a:1' })).toEqual(['tcp://a:1'])
    expect(effectivePeers({ networking_method: 'PublicServer', public_server_url: 'tcp://a:1' })).toEqual(['tcp://a:1'])
    expect(effectivePeers({
      networking_method: 'Manual', peer_urls: ['tcp://b:1', 'tcp://a:1', 'tcp://a:1'], peers: [{ uri: 'udp://c:2' }],
    })).toEqual(['tcp://a:1', 'tcp://b:1', 'udp://c:2'])
    expect(effectivePeers({ networking_method: 2, peer_urls: ['tcp://x:1'] })).toEqual([])
    expect(effectivePeers({ networking_method: 1 })).toEqual([])
  })
})

describe('subnetOf', () => {
  it('the subnet of a fixed IP', () => {
    expect(subnetOf({ dhcp: false, virtual_ipv4: '10.150.0.2', network_length: 24 })).toBe('10.150.0.0/24')
    expect(subnetOf({ dhcp: false, virtual_ipv4: '10.150.3.2' })).toBe('10.150.3.0/24')
    expect(subnetOf({ dhcp: false, virtual_ipv4: '10.150.3.2', network_length: 16 })).toBe('10.150.0.0/16')
    expect(subnetOf({ dhcp: true, virtual_ipv4: '10.150.0.2' })).toBeNull()
    expect(subnetOf({ dhcp: false })).toBeNull()
  })
})

describe('draftFromGroup', () => {
  it('takes the most common values of the running instances', () => {
    const { draft, conflicts, serverUnion } = draftFromGroup(office())
    expect(draft.form.displayName).toBe('office')
    expect(draft.form.networkName).toBe('office')
    expect(draft.secret).toBe('office-secret')
    expect(draft.form.virtualCidr).toBe('10.150.0.0/24')
    expect(draft.form.method).toBe('Manual')
    expect(draft.form.peerUrls).toEqual(['tcp://core1:11010'])
    expect(draft.form.secureMode).toBe(false)
    expect(conflicts.connectivity).toEqual([
      { value: 'tcp://core1:11010', count: 2 },
      { value: 'tcp://core2:11010', count: 1 },
    ])
    expect(conflicts.networkName).toEqual([])
    expect(conflicts.secret).toEqual([])
    expect(conflicts.subnet).toEqual([])
    expect(serverUnion).toEqual(['tcp://core1:11010', 'tcp://core2:11010'])
  })

  it('a group whose top connectivity comes only from PublicServer configs drafts PublicServer', () => {
    const ps = (c: object) => ({ ...c, networking_method: 'PublicServer', public_server_url: 'tcp://core1:11010', peer_urls: [] })
    const g = groupLegacy([
      inst('core2', 'office', true, ps(cfgCore2)),
      inst('core3', 'office', true, ps(cfgCore3)),
    ], devices, [])[0]!
    const { draft } = draftFromGroup(g)
    expect(draft.form.method).toBe('PublicServer')
    expect(draft.form.publicServerUrl).toBe('tcp://core1:11010')
    expect(draft.form.peerUrls).toEqual([])
  })

  it('a group with only disabled instances counts all of them', () => {
    const lab = groupLegacy(all, devices, []).find((g) => g.networkName === 'lab-old')!
    const { draft } = draftFromGroup(lab)
    expect(draft.form.networkName).toBe('lab-old')
    expect(draft.secret).toBe('lab-old-secret')
    expect(draft.form.virtualCidr).toBe('')
    expect(draft.form.method).toBe('Standalone')
  })

  it('ties go to the value of the first device by name and are listed as conflicts', () => {
    const g = groupLegacy([
      inst('core3', 'office', true, { ...cfgCore3, network_secret: 's3' }),
      inst('core2', 'office', true, { ...cfgCore2, network_secret: 's2' }),
    ], devices, [])[0]!
    const { draft, conflicts } = draftFromGroup(g)
    expect(draft.secret).toBe('s2')
    expect(conflicts.secret.map((c) => c.value).sort()).toEqual(['s2', 's3'])
  })

  it('lists differing subnets and network names', () => {
    const g = groupLegacy([
      inst('core1', 'office', true, cfgCore1),
      inst('core2', 'office', true, { ...cfgCore2, virtual_ipv4: '10.151.0.2' }),
      inst('core3', 'office', true, cfgCore3),
    ], devices, [])[0]!
    const { draft, conflicts } = draftFromGroup(g)
    expect(draft.form.virtualCidr).toBe('10.150.0.0/24')
    expect(conflicts.subnet).toEqual([{ value: '10.150.0.0/24', count: 2 }, { value: '10.151.0.0/24', count: 1 }])
  })
})
