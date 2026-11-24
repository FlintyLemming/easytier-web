import type { BlockedDevice } from '../api/types'
import type { DeviceView } from './devices'
import { compareVersions } from './version'

export const OFFLINE_ATTENTION_MS = 86_400_000

export type AttentionItem =
  | { kind: 'blocked'; id: string; name: string; attempts: number; lastAttempt: string | null }
  | { kind: 'unjoined'; device: DeviceView }
  | { kind: 'offline'; device: DeviceView; since: string }
  | { kind: 'outdated'; count: number; byVersion: { version: string; names: string[] }[] }

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const time = (s: string | null | undefined) => {
  const n = s ? new Date(s).getTime() : NaN
  return Number.isNaN(n) ? 0 : n
}

/** Order: blocked → unjoined → offline → outdated (spec: the overview 「需要关注」 list). */
export function buildAttention(i: {
  devices: DeviceView[]
  blocked: BlockedDevice[]
  central: boolean
  hasPrimary: boolean
  now: number
}): AttentionItem[] {
  const out: AttentionItem[] = []

  const blocked = i.blocked
    .filter((b) => b.attempt_count > 0)
    .sort((a, b) => time(b.last_attempt_time) - time(a.last_attempt_time))
  for (const b of blocked) {
    out.push({
      kind: 'blocked',
      id: b.id,
      name: b.alias || b.hostname || b.id,
      attempts: b.attempt_count,
      lastAttempt: b.last_attempt_time ?? null,
    })
  }

  if (i.central && i.hasPrimary) {
    const unjoined = i.devices
      .filter((d) => !d.pending && d.defaultNetworkId === null)
      .sort((a, b) => Number(b.online) - Number(a.online) || byName(a.name, b.name))
    for (const device of unjoined) out.push({ kind: 'unjoined', device })
  }

  const offline: { device: DeviceView; since: string; t: number }[] = []
  for (const device of i.devices) {
    if (device.online || !device.lastSeen) continue
    const t = new Date(device.lastSeen).getTime()
    if (Number.isNaN(t) || i.now - t <= OFFLINE_ATTENTION_MS) continue
    offline.push({ device, since: device.lastSeen, t })
  }
  offline.sort((a, b) => b.t - a.t)
  for (const o of offline) out.push({ kind: 'offline', device: o.device, since: o.since })

  const groups = new Map<string, string[]>()
  let count = 0
  for (const d of i.devices) {
    if (!d.outdated) continue
    count++
    const names = groups.get(d.version)
    if (names) names.push(d.name)
    else groups.set(d.version, [d.name])
  }
  if (count > 0) {
    const byVersion = [...groups.entries()]
      .map(([version, names]) => ({ version, names: names.sort(byName) }))
      .sort((a, b) => compareVersions(b.version, a.version))
    out.push({ kind: 'outdated', count, byVersion })
  }
  return out
}
