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
  /** Saves a config without running it (creates the instance disabled if it does not exist). */
  saveInstanceConfig(machineId: string, instId: string, config: object): Promise<void>
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
/** Where a rollback stopped: removing the member, or enabling / recreating the legacy instance. */
export type RollbackStep = 'removeMember' | 'enable'

/** The message of a migratedKeptLegacy outcome whose record could not be saved (the UI translates it). */
export const JOURNAL_NOT_SAVED = 'journal-not-saved'

export type DeviceOutcome =
  | { kind: 'migrated' }
  /** Migrated, but the (disabled) legacy instance was not deleted: the delete failed, or the record was not saved. */
  | { kind: 'migratedKeptLegacy'; message: string }
  /** `changed`: the recheck found these unconfirmed changes (spec: 「预览之后配置有变化」). */
  | { kind: 'rolledBack'; step: StepName; message: string; changed?: ChangeKey[] }
  /** The step failed and so did the rollback, at `rollbackStep`. */
  | { kind: 'needsAttention'; step: StepName; message: string; rollbackStep: RollbackStep }

export interface RunTiming {
  pollMs: number
  runningTimeoutMs: number
  goneTimeoutMs: number
}

export const DEFAULT_TIMING: RunTiming = { pollMs: 2_000, runningTimeoutMs: 120_000, goneTimeoutMs: 90_000 }

export interface RunHooks {
  onStep(step: StepName): void
  /** Persists the device's record (called several times as it progresses); false = not saved. */
  record(rec: MigrationRecord): boolean | void
  sleep?(ms: number): Promise<void>
  now?(): number
  timing?: RunTiming
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404

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
  return { timing, poll, now }
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

/**
 * Spec §5.10.2 step 4 for one device; every failure path rolls back or reports needsAttention.
 * The device's record is written before anything is touched (inProgress) and updated as it goes,
 * so a run cut off half way still shows up in the report. A rollback restores the legacy instance
 * to what it was: an instance that was disabled before the migration stays disabled.
 */
export async function migrateDevice(
  api: MigrationApi,
  input: {
    networkId: string
    networkName: string
    preview: DevicePreview
    target: TargetNetwork
    confirmed: ReadonlySet<ChangeKey>
    /** The auto-selected address chosen in step 3 (not re-chosen here). */
    newIp?: string | null
  },
  hooks: RunHooks,
): Promise<DeviceOutcome> {
  const t = tools(hooks)
  const { networkId, preview, target, confirmed } = input
  const dev = preview.device.id
  const inst = preview.instance.instanceId
  const wasRunning = preview.instance.running

  let rec: MigrationRecord = {
    deviceId: dev,
    deviceName: preview.device.name,
    networkId,
    networkName: input.networkName,
    instanceId: inst,
    config: preview.instance.config,
    confirmed: [...confirmed],
    member: preview.plan.member,
    status: 'inProgress',
    step: 'disable',
    wasRunning,
    migratedAt: t.now(),
  }
  const save = (patch: Partial<MigrationRecord>) => {
    rec = { ...rec, ...patch }
    return hooks.record(rec) !== false
  }
  const attention = (step: StepName, msg: string, rollbackStep: RollbackStep): DeviceOutcome => {
    save({ status: 'needsAttention', step, message: msg, rollbackStep })
    return { kind: 'needsAttention', step, message: msg, rollbackStep }
  }

  let step: StepName = 'disable'
  hooks.onStep(step)
  save({})
  try {
    await api.setInstanceDisabled(dev, inst, true)
  } catch (e) {
    const failure = message(e)
    // The request can fail after the device acted (a timeout, a dropped answer): look before
    // deciding. An unreachable device (404 Client not found) cannot have acted.
    let stopped = false
    if (wasRunning && !isNotFound(e)) {
      try {
        stopped = !(await api.listInstances(dev)).running.includes(inst)
      } catch { /* unreachable now: nothing to restore from here */ }
    }
    if (stopped) {
      try {
        await api.setInstanceDisabled(dev, inst, false)
      } catch (r) {
        return attention(step, `${failure}; ${message(r)}`, 'enable')
      }
    }
    save({ status: 'rolledBack', step, message: failure })
    return { kind: 'rolledBack', step, message: failure }
  }

  /** Set before the join request: a failed request may still have added the member. */
  let joinAttempted = false
  let stored = preview.instance.config
  let plan = preview.plan
  try {
    step = 'recheck'
    hooks.onStep(step)
    save({ step })
    stored = await api.getInstanceConfig(dev, inst)
    plan = classifyInstance(stored, preview.device.hostname, target, { newIp: input.newIp ?? null })
    save({ config: stored, member: plan.member })
    const extra = unconfirmedChanges(plan, confirmed)
    if (extra.length) throw new ChangedSincePreview(extra)

    step = 'join'
    hooks.onStep(step)
    save({ step })
    joinAttempted = true
    await api.addMembers(networkId, [dev])

    step = 'settings'
    hooks.onStep(step)
    save({ step })
    const patch: MemberPatch = {}
    if (plan.member.virtualIpv4) patch.virtual_ipv4 = plan.member.virtualIpv4
    if (plan.member.hostnameOverride) patch.hostname_override = plan.member.hostnameOverride
    if (Object.keys(patch).length) await api.updateMember(networkId, dev, patch)
    const body: Record<string, unknown> = { ...plan.override }
    if (plan.member.proxyCidrs.length) body.proxy_cidrs = plan.member.proxyCidrs
    if (Object.keys(body).length) await api.setMemberConfig(networkId, dev, body)

    step = 'wait'
    hooks.onStep(step)
    save({ step })
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
    let rollbackStep: RollbackStep = 'removeMember'
    try {
      if (joinAttempted) {
        try {
          await api.removeMember(networkId, dev)
        } catch (r) {
          if (!isNotFound(r)) throw r
        }
        await waitGone(api, dev, networkId, t)
      }
      rollbackStep = 'enable'
      if (wasRunning) await api.setInstanceDisabled(dev, inst, false)
    } catch (r) {
      return attention(step, `${failure}; ${message(r)}`, rollbackStep)
    }
    save({ status: 'rolledBack', step, message: failure })
    return e instanceof ChangedSincePreview
      ? { kind: 'rolledBack', step, message: failure, changed: e.keys }
      : { kind: 'rolledBack', step, message: failure }
  }

  hooks.onStep('record')
  const saved = save({ status: 'migrated', step: undefined, config: stored, member: plan.member, migratedAt: t.now() })
  // Without the record the legacy config would be the only copy left: keep it (disabled).
  if (!saved) return { kind: 'migratedKeptLegacy', message: JOURNAL_NOT_SAVED }

  hooks.onStep('cleanup')
  try {
    await api.deleteInstance(dev, inst)
  } catch (e) {
    return { kind: 'migratedKeptLegacy', message: message(e) }
  }
  return { kind: 'migrated' }
}

export type RollbackResult =
  | { ok: true }
  /** `removed`: the member was already removed when it failed; `offline`: nothing was changed. */
  | { ok: false; message: string; removed: boolean; offline?: boolean }

/**
 * Spec §5.10.2 step 5 「回滚这台」: refuse while the device is unreachable (removing the member of
 * an offline device would leave it with no network once it is back), then remove the member, wait
 * for its instance to leave the device, and restore the legacy instance as it was: enable it (or
 * recreate it from the record) if it ran before; an instance that was disabled stays disabled.
 */
export async function rollbackDevice(api: MigrationApi, rec: MigrationRecord, hooks: RunHooks): Promise<RollbackResult> {
  const t = tools(hooks)
  const wasRunning = rec.wasRunning !== false
  try {
    await api.listInstances(rec.deviceId)
  } catch (e) {
    return { ok: false, message: message(e), removed: false, offline: true }
  }
  let removed = false
  try {
    try {
      await api.removeMember(rec.networkId, rec.deviceId)
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
    removed = true
    const list = await waitGone(api, rec.deviceId, rec.networkId, t)
    const exists = !!list && (list.running.includes(rec.instanceId) || list.disabled.includes(rec.instanceId))
    if (wasRunning) {
      if (exists) await api.setInstanceDisabled(rec.deviceId, rec.instanceId, false)
      else await api.runInstance(rec.deviceId, rec.config, true)
      const running = await t.poll(async () => {
        const l = await api.listInstances(rec.deviceId)
        return l.running.includes(rec.instanceId) ? true : undefined
      }, t.timing.runningTimeoutMs)
      if (!running) return { ok: false, message: 'timeout', removed }
    } else if (!exists) {
      await api.saveInstanceConfig(rec.deviceId, rec.instanceId, rec.config)
      const there = await t.poll(async () => {
        const l = await api.listInstances(rec.deviceId)
        return l.disabled.includes(rec.instanceId) || l.running.includes(rec.instanceId) ? true : undefined
      }, t.timing.runningTimeoutMs)
      if (!there) return { ok: false, message: 'timeout', removed }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: message(e), removed }
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
    // The address the member was given (an auto-selected one differs from the legacy config).
    if (rec.member.virtualIpv4) expectedConfig.virtual_ipv4 = rec.member.virtualIpv4
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
