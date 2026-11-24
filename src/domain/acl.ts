import { v4 } from 'uuid'
import type { AclAction, AclDestination, AclPolicy, AclProtocol, AclProtocolTarget, AclRule, AclSource } from '../api/types'

/** `'all' | 'member:<id>' | 'group:<name>' | 'subnet:<memberId>:<cidr>'` */
export type SelectorKey = string

export function sourceKeys(sources: AclSource[]): SelectorKey[] {
  return sources.map((s) => (s.type === 'all' ? 'all' : s.type === 'member' ? `member:${s.member_id}` : `group:${s.name}`))
}

export function destinationKeys(dests: AclDestination[]): SelectorKey[] {
  return dests.flatMap((d) =>
    d.type === 'all' ? ['all'] : d.type === 'member' ? [`member:${d.member_id}`] : d.cidrs.map((c) => `subnet:${d.member_id}:${c}`),
  )
}

const sameSet = (a: string[], b: string[]) => {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every((x) => sb.has(x))
}

export function sourcesFromKeys(keys: SelectorKey[], original?: AclSource[]): AclSource[] {
  if (original && sameSet(keys, sourceKeys(original))) return original
  return keys.map((k): AclSource => {
    if (k === 'all') return { type: 'all' }
    if (k.startsWith('member:')) return { type: 'member', member_id: k.slice('member:'.length) }
    return { type: 'group', name: k.slice('group:'.length) }
  })
}

export function destinationsFromKeys(keys: SelectorKey[], original?: AclDestination[]): AclDestination[] {
  if (original && sameSet(keys, destinationKeys(original))) return original
  const out: AclDestination[] = []
  const subnets = new Map<string, { type: 'subnet'; member_id: string; cidrs: string[] }>()
  for (const k of keys) {
    if (k === 'all') out.push({ type: 'all' })
    else if (k.startsWith('member:')) out.push({ type: 'member', member_id: k.slice('member:'.length) })
    else if (k.startsWith('subnet:')) {
      const rest = k.slice('subnet:'.length)
      const sep = rest.indexOf(':')
      const memberId = rest.slice(0, sep)
      const cidr = rest.slice(sep + 1)
      const existing = subnets.get(memberId)
      if (existing) existing.cidrs.push(cidr)
      else {
        const sel = { type: 'subnet' as const, member_id: memberId, cidrs: [cidr] }
        subnets.set(memberId, sel)
        out.push(sel)
      }
    }
  }
  return out
}

export interface ProtocolDraft {
  protocol: AclProtocol
  /** Comma-separated ports or ranges; blank means every port. */
  ports: string
  stateful: boolean
}

export interface RuleDraft {
  id: string | null
  name: string
  enabled: boolean
  action: AclAction
  sources: SelectorKey[]
  destinations: SelectorKey[]
  protocols: ProtocolDraft[]
}

export type RuleError = 'name' | 'sources' | 'destinations' | 'protocols' | `ports:${number}` | `stateful:${number}`

export function blankRule(): RuleDraft {
  return {
    id: null,
    name: '',
    enabled: true,
    action: 'allow',
    sources: [],
    destinations: [],
    protocols: [{ protocol: 'tcp', ports: '', stateful: true }],
  }
}

export function ruleToDraft(rule: AclRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    action: rule.action,
    sources: sourceKeys(rule.sources),
    destinations: destinationKeys(rule.destinations),
    protocols: rule.protocols.map((p) => ({ protocol: p.protocol, ports: p.ports.join(', '), stateful: p.stateful })),
  }
}

/** Same rule as the backend (compiler.rs validate_protocol_target): a u16 > 0, or `start-end` with start <= end. */
export function validPort(p: string): boolean {
  const num = (s: string) => (/^\d{1,5}$/.test(s) ? Number(s) : NaN)
  const dash = p.indexOf('-')
  if (dash < 0) {
    const n = num(p)
    return n >= 1 && n <= 65535
  }
  const start = num(p.slice(0, dash))
  const end = num(p.slice(dash + 1))
  return start >= 1 && end <= 65535 && start <= end
}

export function parsePorts(text: string): string[] | null {
  const items = text.split(',').map((s) => s.trim()).filter((s) => s !== '')
  return items.every(validPort) ? items : null
}

const isIcmp = (p: AclProtocol) => p === 'icmp' || p === 'icmpv6'

export function ruleErrors(d: RuleDraft): RuleError[] {
  const out: RuleError[] = []
  if (!d.name.trim()) out.push('name')
  if (d.sources.length === 0) out.push('sources')
  if (d.destinations.length === 0) out.push('destinations')
  if (d.protocols.length === 0) out.push('protocols')
  d.protocols.forEach((p, i) => {
    const ports = parsePorts(p.ports)
    if (ports === null || (isIcmp(p.protocol) && ports.length > 0)) out.push(`ports:${i}`)
    if (p.stateful && p.protocol !== 'tcp') out.push(`stateful:${i}`)
  })
  return out
}

function protocolsFromDraft(drafts: ProtocolDraft[], original?: AclProtocolTarget[]): AclProtocolTarget[] {
  const built = drafts.map((p) => ({
    protocol: p.protocol,
    ports: isIcmp(p.protocol) ? [] : (parsePorts(p.ports) ?? []),
    stateful: p.stateful,
  }))
  if (
    original &&
    original.length === built.length &&
    original.every(
      (o, i) =>
        o.protocol === built[i]!.protocol &&
        o.stateful === built[i]!.stateful &&
        o.ports.length === built[i]!.ports.length &&
        o.ports.every((x, j) => x === built[i]!.ports[j]),
    )
  ) {
    return original
  }
  return built
}

export function draftToRule(d: RuleDraft, original?: AclRule): AclRule {
  return {
    id: original?.id ?? v4(),
    name: d.name.trim(),
    enabled: d.enabled,
    action: d.action,
    sources: sourcesFromKeys(d.sources, original?.sources),
    destinations: destinationsFromKeys(d.destinations, original?.destinations),
    protocols: protocolsFromDraft(d.protocols, original?.protocols),
  }
}

export function moveRule(rules: AclRule[], index: number, delta: -1 | 1): AclRule[] {
  const to = index + delta
  if (index < 0 || index >= rules.length || to < 0 || to >= rules.length) return rules
  const next = [...rules]
  next[index] = rules[to]!
  next[to] = rules[index]!
  return next
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

export function policyEquals(a: AclPolicy, b: AclPolicy): boolean {
  return deepEqual(a, b)
}

/** Default deny with no enabled allow rule: every packet between members is dropped. */
export function allowsNothing(policy: AclPolicy): boolean {
  return policy.default_action === 'deny' && !policy.rules.some((r) => r.enabled && r.action === 'allow')
}
