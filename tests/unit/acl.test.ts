import { describe, expect, it } from 'vitest'
import type { AclPolicy, AclRule } from '../../src/api/types'
import {
  allowsNothing, blankRule, destinationKeys, destinationsFromKeys, draftToRule, moveRule, parsePorts, policyEquals,
  ruleErrors, ruleToDraft, sourceKeys, sourcesFromKeys, validPort, type RuleDraft,
} from '../../src/domain/acl'

const R: AclRule = {
  id: 'r9',
  name: 'n',
  enabled: true,
  action: 'allow',
  sources: [{ type: 'member', member_id: 'm1' }, { type: 'group', name: 'member:t1' }],
  destinations: [
    { type: 'subnet', member_id: 'm1', cidrs: ['192.168.1.0/24'] },
    { type: 'subnet', member_id: 'm1', cidrs: ['192.168.2.0/24'] },
  ],
  protocols: [{ protocol: 'any', ports: ['53'], stateful: false }, { protocol: 'tcp', ports: [], stateful: false }],
}

const ready = (over: Partial<RuleDraft> = {}): RuleDraft => ({ ...blankRule(), name: 'x', sources: ['all'], destinations: ['all'], ...over })

describe('ports', () => {
  it('validPort follows the backend rule', () => {
    for (const p of ['22', '1', '65535', '1-65535', '80-80']) expect(validPort(p), p).toBe(true)
    for (const p of ['0', '70000', '90-80', 'abc', '1-', '-5', ' 22', '+22', '22 ', '0-5', '1-70000', '']) expect(validPort(p), p).toBe(false)
  })

  it('parsePorts splits on commas, trims, drops blanks, rejects any bad item', () => {
    expect(parsePorts(' 22, 80-90 ,')).toEqual(['22', '80-90'])
    expect(parsePorts('22,x')).toBeNull()
    expect(parsePorts('')).toEqual([])
    expect(parsePorts('  ')).toEqual([])
  })
})

describe('ruleErrors', () => {
  it('flags each invalid part', () => {
    expect(ruleErrors(ready())).toEqual([])
    expect(ruleErrors(ready({ name: '  ' }))).toContain('name')
    expect(ruleErrors(ready({ sources: [] }))).toContain('sources')
    expect(ruleErrors(ready({ destinations: [] }))).toContain('destinations')
    expect(ruleErrors(ready({ protocols: [] }))).toContain('protocols')
    expect(ruleErrors(ready({ protocols: [{ protocol: 'icmp', ports: '1', stateful: false }] }))).toContain('ports:0')
    expect(ruleErrors(ready({ protocols: [{ protocol: 'tcp', ports: '0', stateful: false }] }))).toContain('ports:0')
    expect(ruleErrors(ready({ protocols: [{ protocol: 'tcp', ports: '22', stateful: false }, { protocol: 'udp', ports: '', stateful: true }] }))).toEqual(['stateful:1'])
  })

  it('a blank rule starts enabled, allowing, with one stateful TCP row', () => {
    expect(blankRule()).toEqual({
      id: null, name: '', enabled: true, action: 'allow', sources: [], destinations: [],
      protocols: [{ protocol: 'tcp', ports: '', stateful: true }],
    })
  })
})

describe('selectors', () => {
  it('turn into keys, one per subnet CIDR', () => {
    expect(sourceKeys(R.sources)).toEqual(['member:m1', 'group:member:t1'])
    expect(destinationKeys(R.destinations)).toEqual(['subnet:m1:192.168.1.0/24', 'subnet:m1:192.168.2.0/24'])
    expect(sourceKeys([{ type: 'all' }])).toEqual(['all'])
  })

  it('rebuild from keys, merging one member’s subnets in key order', () => {
    expect(destinationsFromKeys(['subnet:m1:a', 'subnet:m1:b', 'all'])).toEqual([
      { type: 'subnet', member_id: 'm1', cidrs: ['a', 'b'] },
      { type: 'all' },
    ])
    expect(sourcesFromKeys(['all', 'member:m2', 'group:g:x'])).toEqual([
      { type: 'all' }, { type: 'member', member_id: 'm2' }, { type: 'group', name: 'g:x' },
    ])
  })

  it('return the original array when the key set is unchanged', () => {
    expect(destinationsFromKeys([...destinationKeys(R.destinations)].reverse(), R.destinations)).toBe(R.destinations)
    expect(sourcesFromKeys(sourceKeys(R.sources), R.sources)).toBe(R.sources)
  })
})

describe('draft round trip (Review Focus 1)', () => {
  it('an untouched rule comes back deeply equal, keeping the same selector and protocol arrays', () => {
    const back = draftToRule(ruleToDraft(R), R)
    expect(back).toEqual(R)
    expect(back.destinations).toBe(R.destinations)
    expect(back.sources).toBe(R.sources)
    expect(back.protocols).toBe(R.protocols)
  })

  it('a changed selection rebuilds only that side', () => {
    const d = ruleToDraft(R)
    d.sources = ['all']
    const back = draftToRule(d, R)
    expect(back.sources).toEqual([{ type: 'all' }])
    expect(back.destinations).toBe(R.destinations)
    expect(back.id).toBe('r9')
  })

  it('changed protocols are rebuilt from the draft; name is trimmed', () => {
    const d = ruleToDraft(R)
    d.name = '  web '
    d.protocols = [{ protocol: 'tcp', ports: '80, 443', stateful: true }]
    const back = draftToRule(d, R)
    expect(back.name).toBe('web')
    expect(back.protocols).toEqual([{ protocol: 'tcp', ports: ['80', '443'], stateful: true }])
  })

  it('a new rule gets a uuid v4 id', () => {
    const back = draftToRule(ready())
    expect(back.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(back).toMatchObject({ name: 'x', enabled: true, action: 'allow', sources: [{ type: 'all' }], destinations: [{ type: 'all' }] })
  })
})

describe('policy helpers', () => {
  const a = { ...R, id: 'a' }
  const b = { ...R, id: 'b' }
  const c = { ...R, id: 'c' }

  it('moveRule swaps neighbours and ignores moves past the ends', () => {
    const rules = [a, b, c]
    expect(moveRule(rules, 0, -1)).toBe(rules)
    expect(moveRule(rules, 2, 1)).toBe(rules)
    expect(moveRule(rules, 0, 1).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(moveRule(rules, 2, -1).map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(rules.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('policyEquals compares deeply', () => {
    const p: AclPolicy = { default_action: 'allow', rules: [a] }
    expect(policyEquals(p, structuredClone(p))).toBe(true)
    expect(policyEquals(p, { ...p, default_action: 'deny' })).toBe(false)
    expect(policyEquals(p, { ...p, rules: [{ ...a, enabled: false }] })).toBe(false)
  })

  it('allowsNothing: deny by default with no enabled allow rule', () => {
    const allowOff = { ...R, enabled: false }
    expect(allowsNothing({ default_action: 'deny', rules: [allowOff] })).toBe(true)
    expect(allowsNothing({ default_action: 'deny', rules: [{ ...R, action: 'deny' }] })).toBe(true)
    expect(allowsNothing({ default_action: 'deny', rules: [R] })).toBe(false)
    expect(allowsNothing({ default_action: 'allow', rules: [] })).toBe(false)
  })
})
