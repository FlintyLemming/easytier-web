import type { SettingsForm } from '../networks'

/** A legacy instance config as `GET /machines/{id}/networks/config/{inst}` returns it. */
export type LegacyConfig = Record<string, unknown>

export interface DeviceRef {
  id: string
  /** Alias or OS hostname, as the device list shows it. */
  name: string
  /** OS hostname from the heartbeat (`info.hostname`). */
  hostname: string
  online: boolean
}

/** A per-device instance that is not a central network's instance (spec §5.10.2). */
export interface LegacyInstance {
  deviceId: string
  instanceId: string
  networkName: string
  /** In `running_inst_ids`; otherwise it counts as disabled (no API exposes the stored flag). */
  running: boolean
  config: LegacyConfig
}

export interface LegacyGroup {
  networkName: string
  /** Sorted by device name. */
  instances: LegacyInstance[]
  runningCount: number
  disabledCount: number
  /** The central network whose `network_name` equals this group's name, if any. */
  targetNetworkId: string | null
}

export interface ValueCount {
  value: string
  count: number
}

export interface NetworkDraft {
  form: SettingsForm
  secret: string
}

/** Values that differ inside a group; each list is empty unless there are two or more values. */
export interface DraftConflicts {
  networkName: ValueCount[]
  secret: ValueCount[]
  connectivity: ValueCount[]
  subnet: ValueCount[]
}
