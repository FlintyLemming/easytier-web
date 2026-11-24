import { describe, expect, it } from 'vitest'
import list from '../fixtures/v2.7.1/instances-core2.json'
import metas from '../fixtures/v2.7.1/instance-metas-core2.json'
import info from '../fixtures/v2.7.1/instance-info-core2.json'
import index from '../fixtures/v2.7.1/index.json'
import { buildInstanceRows, manualInstanceIds } from '../../src/domain/instances'
import { uuidToStr } from '../../src/lib/uuid'
import type { InstanceList, InstanceMeta, InstanceRunningInfo } from '../../src/api/types'

const MANUAL = '5eed0000-0000-4000-8000-000000000001'
const CENTRAL = '66b08ebb-fbf8-47f4-b4b6-24aba31ee1d0'
const fixtureList: InstanceList = {
  running: list.running_inst_ids.map((u) => uuidToStr(u)),
  disabled: list.disabled_inst_ids.map((u) => uuidToStr(u)),
}
const running = (info.info.map as Record<string, unknown>)[MANUAL] as InstanceRunningInfo

function meta(over: Partial<InstanceMeta> = {}): InstanceMeta {
  return { networkName: 'n', instanceName: 'i', source: 'web', permission: 0, ...over }
}

describe('manualInstanceIds', () => {
  it('drops central networks and keeps the manual one', () => {
    expect(index.networkId).toBeTruthy()
    expect(manualInstanceIds(fixtureList, [CENTRAL])).toEqual([{ id: MANUAL, disabled: false }])
  })

  it('lists running first, then disabled, each in order; a duplicate counts as disabled', () => {
    const l: InstanceList = { running: ['a', 'b', 'c'], disabled: ['d', 'b', 'e'] }
    expect(manualInstanceIds(l, ['c'])).toEqual([
      { id: 'a', disabled: false },
      { id: 'd', disabled: true },
      { id: 'b', disabled: true },
      { id: 'e', disabled: true },
    ])
  })
})

describe('buildInstanceRows', () => {
  it('derives name, ipv4, flags from the fixtures', () => {
    const [row] = buildInstanceRows(
      [{ id: MANUAL, disabled: false }],
      { [MANUAL]: meta({ networkName: 'lab-manual', instanceName: 'lab-manual', source: 'user' }) },
      { [MANUAL]: running },
    )
    expect(row).toEqual({
      id: MANUAL, name: 'lab-manual', state: 'running', errorMsg: null, ipv4: '10.88.0.3/24',
      local: true, editable: true, deletable: true,
    })
  })

  it('derives all four states', () => {
    const ids = ['r', 's', 'e', 'd'].map((id) => ({ id, disabled: id === 'd' }))
    const rows = buildInstanceRows(ids, {}, {
      r: { running: true },
      s: { running: false },
      e: { running: false, error_msg: 'boom' },
      d: { running: true },
    })
    const state = Object.fromEntries(rows.map((r) => [r.id, r.state]))
    expect(state).toEqual({ r: 'running', s: 'starting', e: 'error', d: 'disabled' })
    expect(rows.find((r) => r.id === 'e')!.errorMsg).toBe('boom')
  })

  it('missing info means starting with no ip; empty error_msg is not an error', () => {
    const rows = buildInstanceRows([{ id: 'x', disabled: false }, { id: 'y', disabled: false }], {}, { y: { running: false, error_msg: '' } })
    expect(rows.map((r) => [r.state, r.ipv4])).toEqual([['starting', null], ['starting', null]])
  })

  it('name falls back from networkName to instanceName to id', () => {
    const rows = buildInstanceRows(
      [{ id: 'a', disabled: false }, { id: 'b', disabled: false }, { id: 'c', disabled: false }],
      { a: meta({ networkName: 'A', instanceName: 'x' }), b: meta({ networkName: '', instanceName: 'B' }), c: meta({ networkName: '', instanceName: '' }) },
      {},
    )
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'c'])
  })

  it('permission 3 is neither editable nor deletable; web source is not local', () => {
    const [row] = buildInstanceRows([{ id: 'a', disabled: false }], { a: meta({ permission: 3 }) }, {})
    expect(row).toMatchObject({ editable: false, deletable: false, local: false })
    const [only] = buildInstanceRows([{ id: 'a', disabled: false }], { a: meta({ permission: 1 }) }, {})
    expect(only).toMatchObject({ editable: false, deletable: true })
  })

  it('an instance whose meta is unknown is neither editable nor deletable until the meta arrives', () => {
    const [row] = buildInstanceRows([{ id: 'a', disabled: false }], {}, { a: { running: true } })
    expect(row).toMatchObject({ name: 'a', state: 'running', editable: false, deletable: false, local: false })
    const [known] = buildInstanceRows([{ id: 'a', disabled: false }], { a: meta() }, { a: { running: true } })
    expect(known).toMatchObject({ editable: true, deletable: true })
  })

  it('sorts by name', () => {
    const rows = buildInstanceRows(
      [{ id: 'a', disabled: false }, { id: 'b', disabled: false }],
      { a: meta({ networkName: 'zeta' }), b: meta({ networkName: 'alpha' }) },
      {},
    )
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'zeta'])
  })
})
