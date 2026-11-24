import { ApiError } from '../../api/http'
import type { CentralNetworkMember, InstanceList, MemberPatch } from '../../api/types'
import { splitLegacyVpn } from '../vpnPortal'
import { classifyInstance, unconfirmedChanges, type ChangeKey, type DevicePreview, type TargetNetwork } from './classify'
import { diffConfigs, stripSourceTable, verifyIgnore, type FieldDiff } from './compare'
import type { MigrationRecord } from './journal'

/** The client functions the runner uses (a subset of `src/api/client.ts`), injected for tests. */
export interface MigrationApi {
  setInstanceDisabled(machineId: string, instId: string, disabled: boolean): Promise<void>
  getInstanceConfig(machineId: string, instId: string): Promise<Record<string, unknown>>
  listInstances(machineId: string): Promise<InstanceList>
  deleteInstance(machineId: string, instId: string): Promise<void>
  runInstance(machineId: string, config: object, save: boolean): Promise<void>
  addMembers(networkId: string, deviceIds: string[]): Promise<void>
  updateMember(networkId: string, deviceId: string, patch: MemberPatch): Promise<unknown>
  setMemberConfig(networkId: string, deviceId: string, config: object): Promise<void>
  removeMember(networkId: string, deviceId: string): Promise<void>
  listMembers(networkId: string): Promise<{ members: CentralNetworkMember[] }>
  nodeInfo(machineId: string, instId: string): Promise<{ config: string }>
  generateToml(config: object): Promise<{ toml: string } | { error: string }>
  parseToml(toml: string): Promise<{ config: Record<string, unknown> } | { error: string }>
}

export type StepName = 'disable' | 'recheck' | 'join' | 'settings' | 'wait' | 'record' | 'cleanup'

export type DeviceOutcome =
  | { kind: 'migrated' }
  /** Migrated, but deleting the (disabled) legacy instance failed. */
  | { kind: 'migratedKeptLegacy'; message: string }
  /** `changed`: the recheck found these unconfirmed changes (spec: 「预览之后配置有变化」). */
  | { kind: 'rolledBack'; step: StepName; message: string; changed?: ChangeKey[] }
  /** The step failed and so did the rollback. */
  | { kind: 'needsAttention'; step: StepName; message: string }

export interface RunTiming {
  pollMs: number
  runningTimeoutMs: number
  goneTimeoutMs: number
}

export const DEFAULT_TIMING: RunTiming = { pollMs: 2_000, runningTimeoutMs: 120_000, goneTimeoutMs: 90_000 }

export interface RunHooks {
  onStep(step: StepName): void
  record(rec: MigrationRecord): void
  sleep?(ms: number): Promise<void>
  now?(): number
  timing?: RunTiming
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The message of a recheck failure: the change keys found after disabling that were not confirmed. */
export class ChangedSincePreview extends Error {
  constructor(public keys: ChangeKey[]) {
    super(keys.join(', '))
    this.name = 'ChangedSincePreview'
  }
}

function tools(hooks: RunHooks) {
  const timing = hooks.timing ?? DEFAULT_TIMING
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = hooks.now ?? (() => Date.now())
  /** Polls `probe` until it returns a value; failures count as "not yet". Undefined on timeout. */
  async function poll<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T | undefined> {
    const start = now()
    for (;;) {
      try {
        const v = await probe()
        if (v !== undefined) return v
      } catch { /* keep polling */ }
      if (now() - start >= timeoutMs) return undefined
      await sleep(timing.pollMs)
    }
  }
  return { timing, poll }
}

/**
 * Waits until the device no longer runs the central instance; returns the last instance list (or
 * null if it never got one). A timeout is not an error: the rollback goes on regardless.
 */
async function waitGone(api: MigrationApi, deviceId: string, networkId: string, t: ReturnType<typeof tools>): Promise<InstanceList | null> {
  let last: InstanceList | null = null
  await t.poll(async () => {
    last = await api.listInstances(deviceId)
    return last.running.includes(networkId) ? undefined : true
  }, t.timing.goneTimeoutMs)
  return last
}

/** Spec §5.10.2 step 4 for one device; every failure path rolls back or reports needsAttention. */
export async function migrateDevice(
  api: MigrationApi,
  input: { networkId: string; networkName: string; preview: DevicePreview; target: TargetNetwork; confirmed: ReadonlySet<ChangeKey> },
  hooks: RunHooks,
): Promise<DeviceOutcome> {
  const t = tools(hooks)
  const { networkId, preview, target, confirmed } = input
  const dev = preview.device.id
  const inst = preview.instance.instanceId

  let step: StepName = 'disable'
  hooks.onStep(step)
  try {
    await api.setInstanceDisabled(dev, inst, true)
  } catch (e) {
    return { kind: 'rolledBack', step, message: message(e) }
  }

  let joined = false
  let stored: Record<string, unknown>
  let plan
  try {
    step = 'recheck'
    hooks.onStep(step)
    stored = await api.getInstanceConfig(dev, inst)
    plan = classifyInstance(stored, preview.device.hostname, target)
    const extra = unconfirmedChanges(plan, confirmed)
    if (extra.length) throw new ChangedSincePreview(extra)

    step = 'join'
    hooks.onStep(step)
    await api.addMembers(networkId, [dev])
    joined = true

    step = 'settings'
    hooks.onStep(step)
    const patch: MemberPatch = {}
    if (plan.member.virtualIpv4) patch.virtual_ipv4 = plan.member.virtualIpv4
    if (plan.member.hostnameOverride) patch.hostname_override = plan.member.hostnameOverride
    if (Object.keys(patch).length) await api.updateMember(networkId, dev, patch)
    const body: Record<string, unknown> = { ...plan.override }
    if (plan.member.proxyCidrs.length) body.proxy_cidrs = plan.member.proxyCidrs
    if (Object.keys(body).length) await api.setMemberConfig(networkId, dev, body)

    step = 'wait'
    hooks.onStep(step)
    let lastError: string | null = null
    const ok = await t.poll(async () => {
      const { members } = await api.listMembers(networkId)
      const m = members.find((x) => x.device_id === dev)
      if (m?.error_msg) lastError = m.error_msg
      return m?.running === true ? true : undefined
    }, t.timing.runningTimeoutMs)
    if (!ok) throw new Error(lastError ? `timeout: ${lastError}` : 'timeout')
  } catch (e) {
    const failure = message(e)
    try {
      if (joined) {
        await api.removeMember(networkId, dev)
        await waitGone(api, dev, networkId, t)
      }
      await api.setInstanceDisabled(dev, inst, false)
    } catch (r) {
      return { kind: 'needsAttention', step, message: `${failure}; rollback: ${message(r)}` }
    }
    return e instanceof ChangedSincePreview
      ? { kind: 'rolledBack', step, message: failure, changed: e.keys }
      : { kind: 'rolledBack', step, message: failure }
  }

  hooks.onStep('record')
  hooks.record({
    deviceId: dev,
    deviceName: preview.device.name,
    networkId,
    networkName: input.networkName,
    instanceId: inst,
    config: stored,
    confirmed: [...confirmed],
    member: plan.member,
    status: 'migrated',
    migratedAt: Date.now(),
  })

  hooks.onStep('cleanup')
  try {
    await api.deleteInstance(dev, inst)
  } catch (e) {
    return { kind: 'migratedKeptLegacy', message: message(e) }
  }
  return { kind: 'migrated' }
}

/**
 * Spec §5.10.2 step 5 「回滚这台」: remove the member, wait for its instance to leave the device,
 * then enable the legacy instance if it still exists or recreate it from the record.
 */
export async function rollbackDevice(
  api: MigrationApi,
  rec: MigrationRecord,
  hooks: RunHooks,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const t = tools(hooks)
  try {
    try {
      await api.removeMember(rec.networkId, rec.deviceId)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e
    }
    const list = await waitGone(api, rec.deviceId, rec.networkId, t)
    const exists = !!list && (list.running.includes(rec.instanceId) || list.disabled.includes(rec.instanceId))
    if (exists) await api.setInstanceDisabled(rec.deviceId, rec.instanceId, false)
    else await api.runInstance(rec.deviceId, rec.config, true)
    const running = await t.poll(async () => {
      const l = await api.listInstances(rec.deviceId)
      return l.running.includes(rec.instanceId) ? true : undefined
    }, t.timing.runningTimeoutMs)
    if (!running) return { ok: false, message: 'timeout' }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: message(e) }
  }
}

/**
 * Spec §5.10.2 step 5: the member's running config against the legacy config. Both TOMLs go
 * through parse-config; the expected hostname is the override the member was given (without one
 * the core runs with its own hostname, as the legacy instance did).
 */
export async function verifyDevice(
  api: MigrationApi,
  rec: MigrationRecord,
): Promise<{ status: 'consistent' } | { status: 'mismatch'; diffs: FieldDiff[] } | { status: 'unreachable'; message: string }> {
  try {
    const running = (await api.nodeInfo(rec.deviceId, rec.networkId)).config
    if (!running) return { status: 'unreachable', message: 'empty config' }
    const { rest } = splitLegacyVpn(rec.config)
    const expectedConfig: Record<string, unknown> = { ...rest }
    if (rec.member.hostnameOverride) expectedConfig.hostname = rec.member.hostnameOverride
    else delete expectedConfig.hostname
    const gen = await api.generateToml(expectedConfig)
    if ('error' in gen) return { status: 'unreachable', message: gen.error }
    const expected = await api.parseToml(stripSourceTable(gen.toml))
    if ('error' in expected) return { status: 'unreachable', message: expected.error }
    const actual = await api.parseToml(stripSourceTable(running))
    if ('error' in actual) return { status: 'unreachable', message: actual.error }
    const diffs = diffConfigs(expected.config, actual.config, verifyIgnore(rec.confirmed))
    return diffs.length ? { status: 'mismatch', diffs } : { status: 'consistent' }
  } catch (e) {
    return { status: 'unreachable', message: message(e) }
  }
}
