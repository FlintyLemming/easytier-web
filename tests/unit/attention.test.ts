import { describe, expect, it } from 'vitest'
import type { BlockedDevice } from '../../src/api/types'
import { buildAttention } from '../../src/domain/attention'
import type { DeviceView } from '../../src/domain/devices'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const H = 3_600_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function dev(o: Partial<DeviceView> & { name: string }): DeviceView {
  return {
    id: o.name, hostname: o.name, alias: null, os: '', online: true, lastSeen: null, version: '2.7.1', outdated: false,
    publicIp: null, location: null, knownLocation: null, locationCached: false, networks: [], defaultNetworkId: 'n1',
    member: null, ip: null, pending: false, ...o,
  }
}
const blk = (o: Partial<BlockedDevice> & { id: string }): BlockedDevice =>
  ({ user_id: 'u', hostname: 'h-' + o.id, blocked_time: ago(5 * H), attempt_count: 1, ...o }) as BlockedDevice
const run = (devices: DeviceView[], blocked: BlockedDevice[] = [], extra: { central?: boolean; hasPrimary?: boolean } = {}) =>
  buildAttention({ devices, blocked, central: true, hasPrimary: true, now: NOW, ...extra })

describe('buildAttention', () => {
  it('returns [] when nothing needs attention', () => {
    expect(run([dev({ name: 'a' })])).toEqual([])
  })

  it('orders blocked, unjoined, offline, outdated', () => {
    const items = run(
      [
        dev({ name: 'old', outdated: true, version: '2.5.0', online: false, lastSeen: ago(30 * H) }),
        dev({ name: 'solo', defaultNetworkId: null }),
        dev({ name: 'gone', online: false, lastSeen: ago(50 * H) }),
      ],
      [blk({ id: 'b1', last_attempt_time: ago(H) })],
    )
    expect(items.map((i) => i.kind)).toEqual(['blocked', 'unjoined', 'offline', 'offline', 'outdated'])
  })

  it('blocked: skips zero attempts, sorts by last attempt desc, names alias > hostname > id', () => {
    const items = run([], [
      blk({ id: 'x', attempt_count: 0, last_attempt_time: ago(H) }),
      blk({ id: 'older', alias: 'Al', last_attempt_time: ago(5 * H) }),
      blk({ id: 'newer', hostname: '', last_attempt_time: ago(H) }),
    ])
    expect(items).toEqual([
      { kind: 'blocked', id: 'newer', name: 'newer', attempts: 1, lastAttempt: ago(H) },
      { kind: 'blocked', id: 'older', name: 'Al', attempts: 1, lastAttempt: ago(5 * H) },
    ])
  })

  it('unjoined needs central + primary network and a non-pending device; online first then by name', () => {
    const devices = [
      dev({ name: 'b', defaultNetworkId: null, online: false }),
      dev({ name: 'z', defaultNetworkId: null }),
      dev({ name: 'a', defaultNetworkId: null }),
      dev({ name: 'p', defaultNetworkId: null, pending: true }),
    ]
    const names = (xs: ReturnType<typeof run>) => xs.map((i) => (i.kind === 'unjoined' ? i.device.name : '?'))
    expect(names(run(devices))).toEqual(['a', 'z', 'b'])
    expect(run(devices, [], { central: false })).toEqual([])
    expect(run(devices, [], { hasPrimary: false })).toEqual([])
  })

  it('offline: only beyond 24 h with a parsable lastSeen, most recent first', () => {
    const items = run([
      dev({ name: 'h23', online: false, lastSeen: ago(23 * H) }),
      dev({ name: 'h25', online: false, lastSeen: ago(25 * H) }),
      dev({ name: 'h48', online: false, lastSeen: ago(48 * H) }),
      dev({ name: 'null', online: false, lastSeen: null }),
      dev({ name: 'bad', online: false, lastSeen: 'nope' }),
      dev({ name: 'on', online: true, lastSeen: ago(100 * H) }),
    ])
    expect(items.map((i) => (i.kind === 'offline' ? i.device.name : '?'))).toEqual(['h25', 'h48'])
  })

  it('outdated: one row, versions descending, names sorted', () => {
    const items = run([
      dev({ name: 'q', outdated: true, version: '2.5.0' }),
      dev({ name: 'm', outdated: true, version: '2.6.4-abc' }),
      dev({ name: 'c', outdated: true, version: '2.6.4-abc' }),
      dev({ name: 'ok' }),
    ])
    expect(items).toEqual([
      {
        kind: 'outdated',
        count: 3,
        byVersion: [
          { version: '2.6.4-abc', names: ['c', 'm'] },
          { version: '2.5.0', names: ['q'] },
        ],
      },
    ])
  })
})
