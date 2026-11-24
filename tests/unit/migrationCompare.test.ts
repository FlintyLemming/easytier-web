import { describe, expect, it } from 'vitest'
import flowFx from '../fixtures/v2.7.1/migrate/flow-core2.json'
import { diffConfigs, stripSourceTable, verifyIgnore } from '../../src/domain/migration/compare'

const flow = flowFx as unknown as {
  parsedGenerated: Record<string, unknown>
  parsedCentral: Record<string, unknown>
  parsedLegacy: Record<string, unknown>
  centralToml: string
}

describe('diffConfigs', () => {
  it('core2 migrated on the real backend: generated-from-stored equals the running central config', () => {
    expect(diffConfigs(flow.parsedGenerated, flow.parsedCentral, verifyIgnore([]))).toEqual([])
    expect(diffConfigs(flow.parsedLegacy, flow.parsedCentral, verifyIgnore([]))).toEqual([])
  })

  it('reports a changed value by field', () => {
    const actual = { ...flow.parsedCentral, mtu: 1200 }
    expect(diffConfigs(flow.parsedGenerated, actual, verifyIgnore([]))).toEqual([{ field: 'mtu', expected: 1380, actual: 1200 }])
  })

  it('compares connectivity by the addresses, and ignores it once confirmed', () => {
    const actual = { ...flow.parsedCentral, peer_urls: ['tcp://elsewhere:1'], peers: [{ uri: 'tcp://elsewhere:1' }] }
    const diffs = diffConfigs(flow.parsedGenerated, actual, verifyIgnore([]))
    expect(diffs.map((d) => d.field)).toEqual(['connectivity'])
    expect(diffConfigs(flow.parsedGenerated, actual, verifyIgnore(['connectivity']))).toEqual([])
    // PublicServer to the same address is the same connectivity.
    const ps = { ...flow.parsedCentral, networking_method: 'PublicServer', public_server_url: 'tcp://core1:11010', peer_urls: [], peers: [] }
    expect(diffConfigs(flow.parsedGenerated, ps, verifyIgnore([]))).toEqual([])
  })

  it('unset, empty and default values are equal; key order does not matter; array order does', () => {
    expect(diffConfigs({ a: null }, {}, [])).toEqual([])
    expect(diffConfigs({ latency_first: false }, {}, [])).toEqual([])
    expect(diffConfigs({ mtu: 1380 }, {}, [])).toEqual([])
    expect(diffConfigs({ enable_relay_network_whitelist: false }, {}, [])).toEqual([])
    expect(diffConfigs({ o: { x: 1, y: 2 } }, { o: { y: 2, x: 1 } }, [])).toEqual([])
    expect(diffConfigs({ o: { x: 1, y: null } }, { o: { x: 1 } }, [])).toEqual([])
    expect(diffConfigs({ l: ['a', 'b'] }, { l: ['b', 'a'] }, []).map((d) => d.field)).toEqual(['l'])
  })

  it('ignores instance_id and acl always, and the fields of confirmed changes', () => {
    const ignore = verifyIgnore(['network_length'])
    expect(ignore.has('instance_id')).toBe(true)
    expect(ignore.has('acl')).toBe(true)
    expect(ignore.has('network_length')).toBe(true)
    expect(diffConfigs({ acl: { a: 1 }, network_length: 16 }, { network_length: 24 }, ignore)).toEqual([])
  })

  it('results are sorted by field', () => {
    expect(diffConfigs({ b: 1, a: 1 }, { b: 2, a: 2 }, []).map((d) => d.field)).toEqual(['a', 'b'])
  })
})

describe('verifyIgnore', () => {
  it('a confirmed secure_mode change also ignores the credentials a secure network compiles in', () => {
    const ignore = verifyIgnore(['secure_mode'])
    expect(ignore.has('secure_mode')).toBe(true)
    expect(ignore.has('managed_credentials')).toBe(true)
    const actual = { ...flow.parsedCentral, secure_mode: { enabled: true }, managed_credentials: { x: 1 } }
    expect(diffConfigs(flow.parsedGenerated, actual, ignore)).toEqual([])
  })
})

describe('stripSourceTable', () => {
  it('drops the trailing [source] table a 2.6.4 core reports', () => {
    const out = stripSourceTable(flow.centralToml)
    expect(out).not.toContain('[source]')
    expect(out).not.toContain('webhook')
    expect(out).toContain('[[port_forward]]')
    expect(out).toContain('[flags]')
  })

  it('keeps tables after it', () => {
    expect(stripSourceTable('a = 1\n[source]\nsource = "webhook"\n[flags]\nmtu = 1\n')).toBe('a = 1\n[flags]\nmtu = 1\n')
  })
})
