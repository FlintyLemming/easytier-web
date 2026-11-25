import { afterEach, describe, expect, it } from 'vitest'
import storedCore2 from '../fixtures/v2.7.1/migrate/stored-core2-office.json'
import { clearJournal, exportFile, journalKey, loadJournal, removeRecord, upsertRecord, type MigrationRecord } from '../../src/domain/migration/journal'
import type { DevicePreview } from '../../src/domain/migration/classify'

const rec = (over: Partial<MigrationRecord> = {}): MigrationRecord => ({
  deviceId: 'd2', deviceName: 'core2', networkId: 'n1', networkName: 'office', instanceId: 'i2',
  config: storedCore2, confirmed: [], member: { virtualIpv4: '10.150.0.2', hostnameOverride: 'core2-office', proxyCidrs: [] },
  status: 'migrated', migratedAt: 1, ...over,
})

afterEach(() => localStorage.clear())

describe('journal', () => {
  it('is stored per user', () => {
    expect(journalKey('admin')).toBe('et.migrate.admin')
    upsertRecord('admin', rec())
    expect(loadJournal('admin')).toEqual([rec()])
    expect(loadJournal('other')).toEqual([])
  })

  it('replaces the record of the same device and network, keeps others', () => {
    upsertRecord('admin', rec())
    upsertRecord('admin', rec({ networkId: 'n2' }))
    const list = upsertRecord('admin', rec({ status: 'consistent', checkedAt: 5 }))
    expect(list).toHaveLength(2)
    expect(loadJournal('admin').find((r) => r.networkId === 'n1')!.status).toBe('consistent')
  })

  it('corrupt storage reads as empty; invalid entries are dropped', () => {
    localStorage.setItem('et.migrate.admin', '{not json')
    expect(loadJournal('admin')).toEqual([])
    localStorage.setItem('et.migrate.admin', JSON.stringify([rec(), { deviceId: 3 }, null, rec({ status: 'bogus' as never })]))
    expect(loadJournal('admin')).toEqual([rec()])
  })

  it('keeps unfinished and failed records with their step', () => {
    upsertRecord('admin', rec({ status: 'inProgress', step: 'join', wasRunning: true }))
    upsertRecord('admin', rec({ deviceId: 'd3', status: 'needsAttention', step: 'settings', message: 'bad', rollbackStep: 'removeMember' }))
    expect(loadJournal('admin').map((r) => [r.status, r.step])).toEqual([['inProgress', 'join'], ['needsAttention', 'settings']])
  })

  it('removeRecord drops one device of one network', () => {
    upsertRecord('admin', rec())
    upsertRecord('admin', rec({ deviceId: 'd3' }))
    expect(removeRecord('admin', 'd2', 'n1').map((r) => r.deviceId)).toEqual(['d3'])
    expect(loadJournal('admin').map((r) => r.deviceId)).toEqual(['d3'])
  })

  it('clearJournal empties it', () => {
    upsertRecord('admin', rec())
    clearJournal('admin')
    expect(loadJournal('admin')).toEqual([])
  })
})

describe('exportFile', () => {
  it('names the file by network and local time and lists every device', () => {
    const preview = {
      instance: { deviceId: 'd2', instanceId: 'i2', networkName: 'office', running: true, config: storedCore2 },
      device: { id: 'd2', name: 'core2', hostname: 'core2', online: true },
    } as unknown as DevicePreview
    const { filename, text } = exportFile('office', [preview], new Date(2026, 10, 24, 9, 5, 7))
    expect(filename).toBe('easytier-migration-office-20261124-090507.json')
    const data = JSON.parse(text)
    expect(data.format).toBe('easytier-console-migration/1')
    expect(data.network_name).toBe('office')
    expect(typeof data.exported_at).toBe('string')
    expect(data.devices).toEqual([
      { device_id: 'd2', device_name: 'core2', hostname: 'core2', instance_id: 'i2', running: true, config: storedCore2 },
    ])
    expect(text).toContain('\n  "format"')
  })
})
