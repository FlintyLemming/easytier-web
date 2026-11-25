import type { ChangeKey, DevicePreview, MemberFields } from './classify'
import type { FieldDiff } from './compare'
import type { RollbackStep, StepName } from './run'
import type { LegacyConfig } from './types'

/**
 * inProgress: written before the device is touched and kept up to date, so a run that is cut off
 * (tab closed, browser crash) leaves a trace; needsAttention: a step failed and so did its rollback.
 */
export type RecordStatus = 'inProgress' | 'migrated' | 'consistent' | 'mismatch' | 'rolledBack' | 'needsAttention'
const STATUSES: RecordStatus[] = ['inProgress', 'migrated', 'consistent', 'mismatch', 'rolledBack', 'needsAttention']

/**
 * One migrated device, kept in this browser so verification can be done once an offline device is
 * back and a deleted legacy instance can be recreated on rollback. Holds the network secret.
 */
export interface MigrationRecord {
  deviceId: string
  deviceName: string
  networkId: string
  networkName: string
  instanceId: string
  /** The stored legacy config, as read after disabling the instance. */
  config: LegacyConfig
  confirmed: ChangeKey[]
  /** What the member was given (the hostname override decides the expected hostname). */
  member: MemberFields
  status: RecordStatus
  migratedAt: number
  checkedAt?: number
  diffs?: FieldDiff[]
  /** inProgress: the step reached; rolledBack / needsAttention: the step that failed. */
  step?: StepName
  /** rolledBack / needsAttention: what failed. */
  message?: string
  /** needsAttention: the rollback step that failed. */
  rollbackStep?: RollbackStep
  /** Whether the legacy instance ran before the migration; a rollback restores that. Missing = true. */
  wasRunning?: boolean
}

export function journalKey(user: string): string {
  return `et.migrate.${user}`
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function validRecord(v: unknown): v is MigrationRecord {
  if (!isObject(v)) return false
  for (const k of ['deviceId', 'deviceName', 'networkId', 'networkName', 'instanceId']) if (typeof v[k] !== 'string') return false
  if (!isObject(v.config) || !Array.isArray(v.confirmed) || !isObject(v.member)) return false
  if (!STATUSES.includes(v.status as RecordStatus)) return false
  return typeof v.migratedAt === 'number'
}

/** Never throws: missing, corrupt or unreadable storage reads as no records. */
export function loadJournal(user: string): MigrationRecord[] {
  try {
    const raw = localStorage.getItem(journalKey(user))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(validRecord) : []
  } catch {
    return []
  }
}

function save(user: string, records: MigrationRecord[]): boolean {
  try {
    localStorage.setItem(journalKey(user), JSON.stringify(records))
    return true
  } catch {
    return false
  }
}

/** Insert or replace the record of the same device in the same network; returns the new list. */
export function upsertRecord(user: string, rec: MigrationRecord): MigrationRecord[] {
  return saveRecord(user, rec).list
}

/** upsertRecord that also tells whether storage accepted it (full or unavailable storage: false). */
export function saveRecord(user: string, rec: MigrationRecord): { list: MigrationRecord[]; saved: boolean } {
  const list = loadJournal(user).filter((r) => !(r.deviceId === rec.deviceId && r.networkId === rec.networkId))
  list.push(rec)
  return { list, saved: save(user, list) }
}

/** Drops the record of one device in one network; returns the new list. */
export function removeRecord(user: string, deviceId: string, networkId: string): MigrationRecord[] {
  const list = loadJournal(user).filter((r) => !(r.deviceId === deviceId && r.networkId === networkId))
  save(user, list)
  return list
}

export function clearJournal(user: string): void {
  try {
    localStorage.removeItem(journalKey(user))
  } catch { /* ignore */ }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Spec §5.10.2 step 4: the legacy configs of the devices about to migrate, saved before anything runs. */
export function exportFile(networkName: string, previews: DevicePreview[], now: Date): { filename: string; text: string } {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const data = {
    format: 'easytier-console-migration/1',
    exported_at: now.toISOString(),
    network_name: networkName,
    devices: previews.map((p) => ({
      device_id: p.device.id,
      device_name: p.device.name,
      hostname: p.device.hostname,
      instance_id: p.instance.instanceId,
      running: p.instance.running,
      config: p.instance.config,
    })),
  }
  return { filename: `easytier-migration-${networkName}-${stamp}.json`, text: JSON.stringify(data, null, 2) + '\n' }
}
