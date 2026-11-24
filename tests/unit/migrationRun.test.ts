import { describe, expect, it } from 'vitest'
import flowFx from '../fixtures/v2.7.1/migrate/flow-core2.json'
import storedCore2 from '../fixtures/v2.7.1/migrate/stored-core2-office.json'
import storedCore3 from '../fixtures/v2.7.1/migrate/stored-core3-office.json'
import { ApiError } from '../../src/api/http'
import type { CentralNetworkMember, InstanceList } from '../../src/api/types'
import { classifyInstance, type ChangeKey, type DevicePreview, type TargetNetwork } from '../../src/domain/migration/classify'
import type { MigrationRecord } from '../../src/domain/migration/journal'
import {
  JOURNAL_NOT_SAVED, migrateDevice, rollbackDevice, verifyDevice, type MigrationApi, type RunHooks, type StepName,
} from '../../src/domain/migration/run'
import type { LegacyConfig } from '../../src/domain/migration/types'

const NET = 'net-1'
const DEV = 'dev-2'
const INST = 'inst-2'
const target: TargetNetwork = {
  networkName: 'office', secret: 'office-secret', method: 'Manual', publicServerUrl: null,
  peerUrls: ['tcp://core1:11010'], virtualCidr: '10.150.0.0/24', secureMode: false,
}
const flow = flowFx as unknown as Record<string, any>

function preview(config: LegacyConfig = storedCore2, running = true): DevicePreview {
  return {
    instance: { deviceId: DEV, instanceId: INST, networkName: 'office', running, config },
    device: { id: DEV, name: 'core2', hostname: 'core2', online: true },
    plan: classifyInstance(config, 'core2', target),
    blockers: [], alreadyMember: false, defaultSelected: true,
  }
}

type Fail = Partial<Record<keyof MigrationApi, Error>>
class FakeApi implements MigrationApi {
  calls: string[] = []
  fail: Fail = {}
  stored: LegacyConfig = storedCore2
  member: Partial<CentralNetworkMember> | null = null
  /** Member answers in order; the last one repeats. */
  memberStates: Partial<CentralNetworkMember>[] = [{ running: false }, { running: true }]
  /** listInstances answers in order; the last one repeats. */
  lists: InstanceList[] = [{ running: [NET], disabled: [INST] }, { running: [], disabled: [INST] }]
  toml = flow.centralToml as string
  private take<T>(q: T[]): T {
    return q.length > 1 ? q.shift()! : q[0]!
  }
  /** Fails only the first call of that method. */
  failFirst: Fail = {}
  private hit(name: keyof MigrationApi, text: string) {
    this.calls.push(text)
    const once = this.failFirst[name]
    if (once) {
      delete this.failFirst[name]
      throw once
    }
    const e = this.fail[name]
    if (e) throw e
  }
  async setInstanceDisabled(m: string, i: string, d: boolean) { this.hit('setInstanceDisabled', `disable ${i} ${d}`) }
  async getInstanceConfig() { this.hit('getInstanceConfig', 'getConfig'); return this.stored }
  async listInstances() { this.hit('listInstances', 'list'); return this.take(this.lists) }
  async deleteInstance(m: string, i: string) { this.hit('deleteInstance', `delete ${i}`) }
  async runInstance(m: string, c: object, save: boolean) { this.hit('runInstance', `run ${(c as LegacyConfig).instance_id} ${save}`) }
  async saveInstanceConfig(m: string, i: string) { this.hit('saveInstanceConfig', `save ${i}`) }
  async addMembers(n: string, ids: string[]) { this.hit('addMembers', `add ${ids.join(',')}`) }
  async updateMember(n: string, d: string, p: object) { this.hit('updateMember', `patch ${JSON.stringify(p)}`); return {} }
  async setMemberConfig(n: string, d: string, c: object) { this.hit('setMemberConfig', `put ${JSON.stringify(c)}`) }
  async removeMember() { this.hit('removeMember', 'remove') }
  async listMembers() {
    this.hit('listMembers', 'members')
    return { members: [{ device_id: DEV, ...this.take(this.memberStates) } as CentralNetworkMember] }
  }
  async nodeInfo() { this.hit('nodeInfo', 'nodeInfo'); return { config: this.toml } }
  async generateToml(c: object) {
    this.hit('generateToml', `generate ${Object.keys(c).filter((k) => k.includes('vpn')).join(',')}`)
    return { toml: flow.generatedFromStored as string }
  }
  async parseToml(t: string) {
    this.hit('parseToml', 'parse')
    if (t.includes('[source]')) return { error: 'source table not stripped' }
    return { config: t === flow.generatedFromStored ? flow.parsedGenerated : flow.parsedCentral }
  }
}

function hooks(records: MigrationRecord[] = [], steps: StepName[] = []): RunHooks {
  let t = 0
  return {
    onStep: (s) => steps.push(s),
    record: (r) => { records.push(r) },
    sleep: async () => {},
    now: () => (t += 2_000),
    timing: { pollMs: 2_000, runningTimeoutMs: 20_000, goneTimeoutMs: 20_000 },
  }
}
const input = (over: { confirmed?: ChangeKey[]; config?: LegacyConfig; running?: boolean } = {}) => ({
  networkId: NET, networkName: 'office', preview: preview(over.config, over.running ?? true), target, confirmed: new Set(over.confirmed ?? []),
})
const mutating = (calls: string[]) => calls.filter((c) => !/^(list|members|getConfig)$/.test(c))

describe('migrateDevice', () => {
  it('runs disable → recheck → join → settings → wait → record → cleanup', async () => {
    const api = new FakeApi()
    const records: MigrationRecord[] = []
    const steps: StepName[] = []
    const out = await migrateDevice(api, input(), hooks(records, steps))
    expect(out).toEqual({ kind: 'migrated' })
    expect(steps).toEqual(['disable', 'recheck', 'join', 'settings', 'wait', 'record', 'cleanup'])
    expect(api.calls[0]).toBe(`disable ${INST} true`)
    expect(api.calls[1]).toBe('getConfig')
    expect(api.calls[2]).toBe(`add ${DEV}`)
    expect(api.calls[3]).toBe(`patch ${JSON.stringify({ virtual_ipv4: '10.150.0.2', hostname_override: 'core2-office' })}`)
    expect(api.calls[4]).toMatch(/^put /)
    const put = JSON.parse(api.calls[4]!.slice(4))
    expect(put.proxy_cidrs).toEqual(['192.168.88.0/24'])
    expect(put.port_forwards).toEqual(storedCore2.port_forwards)
    expect(api.calls.at(-1)).toBe(`delete ${INST}`)
    expect(records.at(-1)).toMatchObject({
      deviceId: DEV, deviceName: 'core2', networkId: NET, networkName: 'office', instanceId: INST,
      config: storedCore2, confirmed: [], status: 'migrated',
      member: { virtualIpv4: '10.150.0.2', hostnameOverride: 'core2-office', proxyCidrs: ['192.168.88.0/24'] },
      wasRunning: true,
    })
    // The record is written before the legacy instance is deleted.
    expect(steps.indexOf('record')).toBeLessThan(steps.indexOf('cleanup'))
  })

  it('sends no PATCH without IP or hostname, no PUT without override or proxies, and no proxy key when empty', async () => {
    const bare = { instance_id: INST, dhcp: true, network_name: 'office', network_secret: 'office-secret', networking_method: 'Manual', peer_urls: ['tcp://core1:11010'] }
    const api = new FakeApi()
    api.stored = bare
    const out = await migrateDevice(api, input({ config: bare, confirmed: ['dhcp'] }), hooks())
    expect(out.kind).toBe('migrated')
    expect(api.calls.some((c) => c.startsWith('patch'))).toBe(false)
    expect(api.calls.some((c) => c.startsWith('put'))).toBe(false)

    const withOverride = { ...bare, mtu: 1300 }
    const api2 = new FakeApi()
    api2.stored = withOverride
    await migrateDevice(api2, input({ config: withOverride, confirmed: ['dhcp'] }), hooks())
    expect(JSON.parse(api2.calls.find((c) => c.startsWith('put'))!.slice(4))).toEqual({ mtu: 1300 })
  })

  it('disable fails: nothing else happens', async () => {
    const api = new FakeApi()
    api.fail.setInstanceDisabled = new ApiError(404, {}, 'Client not found')
    const out = await migrateDevice(api, input(), hooks())
    expect(out).toEqual({ kind: 'rolledBack', step: 'disable', message: 'Client not found' })
    expect(mutating(api.calls)).toEqual([`disable ${INST} true`])
  })

  it('recheck finds an unconfirmed change: only re-enables', async () => {
    const api = new FakeApi()
    api.stored = { ...storedCore2, peer_urls: ['tcp://elsewhere:1'] }
    const out = await migrateDevice(api, input(), hooks())
    expect(out.kind).toBe('rolledBack')
    expect(out.kind === 'rolledBack' && out.step).toBe('recheck')
    expect(out.kind === 'rolledBack' && out.message).toContain('connectivity')
    expect(out.kind === 'rolledBack' && out.changed).toEqual(['connectivity'])
    expect(mutating(api.calls)).toEqual([`disable ${INST} true`, `disable ${INST} false`])
  })

  it('join fails: removes the member in case the backend added it (404 is fine), then re-enables', async () => {
    const api = new FakeApi()
    api.fail.addMembers = new ApiError(500, {}, 'boom')
    api.fail.removeMember = new ApiError(404, {}, 'member not found')
    const out = await migrateDevice(api, input(), hooks())
    expect(out).toEqual({ kind: 'rolledBack', step: 'join', message: 'boom' })
    expect(mutating(api.calls)).toEqual([`disable ${INST} true`, `add ${DEV}`, 'remove', `disable ${INST} false`])
  })

  for (const [name, step] of [['updateMember', 'settings'], ['setMemberConfig', 'settings']] as const) {
    it(`${name} fails: removes the member, waits for the central instance to go, re-enables`, async () => {
      const api = new FakeApi()
      api.fail[name] = new ApiError(400, {}, 'invalid IPv4 address for member')
      const out = await migrateDevice(api, input(), hooks())
      expect(out).toEqual({ kind: 'rolledBack', step, message: 'invalid IPv4 address for member' })
      const m = mutating(api.calls)
      expect(m.slice(-2)).toEqual(['remove', `disable ${INST} false`])
      const removeAt = api.calls.indexOf('remove')
      expect(api.calls.slice(removeAt + 1, -1).every((c) => c === 'list')).toBe(true)
      expect(api.calls.slice(removeAt + 1, -1).length).toBeGreaterThanOrEqual(2)
    })
  }

  it('wait times out: the message carries the member error; rolled back', async () => {
    const api = new FakeApi()
    api.memberStates = [{ running: false, error_msg: 'boom' }]
    const out = await migrateDevice(api, input(), hooks())
    expect(out.kind).toBe('rolledBack')
    expect(out.kind === 'rolledBack' && out.step).toBe('wait')
    expect(out.kind === 'rolledBack' && out.message).toContain('boom')
    expect(mutating(api.calls).slice(-2)).toEqual(['remove', `disable ${INST} false`])
  })

  it('rollback fails too: needs attention, at the step that failed first', async () => {
    const api = new FakeApi()
    api.fail.updateMember = new ApiError(400, {}, 'bad')
    api.fail.removeMember = new ApiError(500, {}, 'down')
    const out = await migrateDevice(api, input(), hooks())
    expect(out.kind).toBe('needsAttention')
    expect(out.kind === 'needsAttention' && out.step).toBe('settings')
    expect(out.kind === 'needsAttention' && out.message).toContain('down')
  })

  it('cleanup fails: migrated, legacy kept, no rollback', async () => {
    const api = new FakeApi()
    api.fail.deleteInstance = new ApiError(502, {}, 'gone away')
    const records: MigrationRecord[] = []
    const out = await migrateDevice(api, input(), hooks(records))
    expect(out).toEqual({ kind: 'migratedKeptLegacy', message: 'gone away' })
    expect(records.at(-1)!.status).toBe('migrated')
    expect(api.calls).not.toContain('remove')
    expect(api.calls).not.toContain(`disable ${INST} false`)
  })

  it('writes an inProgress record before touching the device, then the outcome', async () => {
    const api = new FakeApi()
    const seen: { status: string; calls: number }[] = []
    const h = hooks()
    h.record = (r) => {
      seen.push({ status: r.status, calls: api.calls.length })
    }
    await migrateDevice(api, input(), h)
    expect(seen[0]).toEqual({ status: 'inProgress', calls: 0 })
    expect(seen.at(-1)!.status).toBe('migrated')
  })

  it('a rollback that works records rolledBack; one that fails records needsAttention with where it stopped', async () => {
    const api = new FakeApi()
    api.fail.updateMember = new ApiError(400, {}, 'bad')
    const records: MigrationRecord[] = []
    await migrateDevice(api, input(), hooks(records))
    expect(records.at(-1)).toMatchObject({ status: 'rolledBack', step: 'settings', message: 'bad' })

    const api2 = new FakeApi()
    api2.fail.updateMember = new ApiError(400, {}, 'bad')
    api2.fail.removeMember = new ApiError(500, {}, 'down')
    const records2: MigrationRecord[] = []
    const out = await migrateDevice(api2, input(), hooks(records2))
    expect(out).toMatchObject({ kind: 'needsAttention', step: 'settings', rollbackStep: 'removeMember' })
    expect(records2.at(-1)).toMatchObject({ status: 'needsAttention', step: 'settings', rollbackStep: 'removeMember' })
  })

  it('the migrated record could not be saved: the legacy instance is kept', async () => {
    const api = new FakeApi()
    const h = hooks()
    h.record = (r) => r.status !== 'migrated'
    const out = await migrateDevice(api, input(), h)
    expect(out).toEqual({ kind: 'migratedKeptLegacy', message: JOURNAL_NOT_SAVED })
    expect(api.calls).not.toContain(`delete ${INST}`)
  })

  it('a legacy instance that was disabled before is not enabled by a rollback', async () => {
    const api = new FakeApi()
    api.fail.updateMember = new ApiError(400, {}, 'bad')
    const records: MigrationRecord[] = []
    const out = await migrateDevice(api, input({ running: false }), hooks(records))
    expect(out.kind).toBe('rolledBack')
    expect(mutating(api.calls)).not.toContain(`disable ${INST} false`)
    expect(records[0]!.wasRunning).toBe(false)
  })

  it('disable fails but the device did stop the instance: it is enabled again', async () => {
    const api = new FakeApi()
    api.failFirst.setInstanceDisabled = new ApiError(0, undefined, 'timeout')
    api.lists = [{ running: [], disabled: [INST] }]
    const out = await migrateDevice(api, input(), hooks())
    expect(out).toEqual({ kind: 'rolledBack', step: 'disable', message: 'timeout' })
    expect(mutating(api.calls)).toEqual([`disable ${INST} true`, `disable ${INST} false`])
  })

  it('disable fails, the device stopped the instance, and enabling fails: needs attention', async () => {
    const api = new FakeApi()
    api.fail.setInstanceDisabled = new ApiError(0, undefined, 'timeout')
    api.lists = [{ running: [], disabled: [INST] }]
    const out = await migrateDevice(api, input(), hooks())
    expect(out).toMatchObject({ kind: 'needsAttention', step: 'disable', rollbackStep: 'enable' })
  })

  it('disable fails and the instance still runs: nothing else happens', async () => {
    const api = new FakeApi()
    api.fail.setInstanceDisabled = new ApiError(0, undefined, 'timeout')
    api.lists = [{ running: [INST], disabled: [] }]
    const out = await migrateDevice(api, input(), hooks())
    expect(out).toEqual({ kind: 'rolledBack', step: 'disable', message: 'timeout' })
    expect(mutating(api.calls)).toEqual([`disable ${INST} true`])
  })
})

describe('rollbackDevice', () => {
  const record = (): MigrationRecord => ({
    deviceId: DEV, deviceName: 'core2', networkId: NET, networkName: 'office', instanceId: INST, config: storedCore2,
    confirmed: [], member: { virtualIpv4: '10.150.0.2', hostnameOverride: 'core2-office', proxyCidrs: [] },
    status: 'mismatch', migratedAt: 1,
  })

  it('legacy instance still there: remove, wait, enable', async () => {
    const api = new FakeApi()
    api.lists = [{ running: [NET], disabled: [INST] }, { running: [], disabled: [INST] }, { running: [INST], disabled: [] }]
    expect(await rollbackDevice(api, record(), hooks())).toEqual({ ok: true })
    expect(mutating(api.calls)).toEqual(['remove', `disable ${INST} false`])
  })

  it('legacy instance deleted: remove, wait, recreate from the record', async () => {
    const api = new FakeApi()
    api.lists = [{ running: [NET], disabled: [] }, { running: [], disabled: [] }, { running: [INST], disabled: [] }]
    expect(await rollbackDevice(api, record(), hooks())).toEqual({ ok: true })
    expect(mutating(api.calls)).toEqual(['remove', `run ${storedCore2.instance_id} true`])
  })

  it('a member that is already gone (404) is fine', async () => {
    const api = new FakeApi()
    api.fail.removeMember = new ApiError(404, {}, 'not found')
    api.lists = [{ running: [], disabled: [INST] }, { running: [INST], disabled: [] }]
    expect(await rollbackDevice(api, record(), hooks())).toEqual({ ok: true })
  })

  it('reports a failure', async () => {
    const api = new FakeApi()
    api.lists = [{ running: [], disabled: [INST] }]
    api.fail.setInstanceDisabled = new ApiError(500, {}, 'nope')
    expect(await rollbackDevice(api, record(), hooks())).toEqual({ ok: false, message: 'nope', removed: true })
  })

  it('refuses while the device is offline, before changing anything', async () => {
    const api = new FakeApi()
    api.fail.listInstances = new ApiError(404, {}, 'Client not found')
    expect(await rollbackDevice(api, record(), hooks())).toEqual({ ok: false, message: 'Client not found', removed: false, offline: true })
    expect(mutating(api.calls)).toEqual([])
  })

  it('an instance that was disabled before: kept disabled, or recreated without running', async () => {
    const api = new FakeApi()
    api.lists = [{ running: [], disabled: [INST] }]
    expect(await rollbackDevice(api, { ...record(), wasRunning: false }, hooks())).toEqual({ ok: true })
    expect(mutating(api.calls)).toEqual(['remove'])

    const api2 = new FakeApi()
    api2.lists = [{ running: [], disabled: [] }, { running: [], disabled: [] }, { running: [], disabled: [INST] }]
    expect(await rollbackDevice(api2, { ...record(), wasRunning: false }, hooks())).toEqual({ ok: true })
    expect(mutating(api2.calls)).toEqual(['remove', `save ${INST}`])
  })
})

describe('verifyDevice', () => {
  const record = (config: LegacyConfig = storedCore2): MigrationRecord => ({
    deviceId: DEV, deviceName: 'core2', networkId: NET, networkName: 'office', instanceId: INST, config,
    confirmed: [], member: { virtualIpv4: '10.150.0.2', hostnameOverride: 'core2-office', proxyCidrs: ['192.168.88.0/24'] },
    status: 'migrated', migratedAt: 1,
  })

  it('consistent for core2 migrated on the real backend', async () => {
    expect(await verifyDevice(new FakeApi(), record())).toEqual({ status: 'consistent' })
  })

  it('unreachable when the node cannot be read', async () => {
    const api = new FakeApi()
    api.fail.nodeInfo = new ApiError(0, undefined, 'timeout')
    expect(await verifyDevice(api, record())).toEqual({ status: 'unreachable', message: 'timeout' })
  })

  it('unreachable with the parse error', async () => {
    const api = new FakeApi()
    api.parseToml = async () => ({ error: 'bad toml' })
    expect(await verifyDevice(api, record())).toEqual({ status: 'unreachable', message: 'bad toml' })
  })

  it('mismatch lists the differing fields', async () => {
    const api = new FakeApi()
    const real = api.parseToml.bind(api)
    api.parseToml = async (t: string) => {
      const r = await real(t)
      return 'config' in r && t !== flow.generatedFromStored ? { config: { ...r.config, mtu: 1200 } } : r
    }
    const out = await verifyDevice(api, record())
    expect(out).toEqual({ status: 'mismatch', diffs: [{ field: 'mtu', expected: 1380, actual: 1200 }] })
  })

  it('generates without legacy VPN fields', async () => {
    const api = new FakeApi()
    await verifyDevice(api, record({ ...storedCore3, enable_vpn_portal: true, vpn_portal_listen_port: 11013 }))
    expect(api.calls.find((c) => c.startsWith('generate'))).toBe('generate ')
  })
})
