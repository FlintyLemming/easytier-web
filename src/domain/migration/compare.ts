import { changeFields, type ChangeKey } from './classify'
import { effectivePeers } from './inventory'
import { isUnset, normalize } from './values'
import type { LegacyConfig } from './types'

const CONNECTIVITY_FIELDS = ['networking_method', 'public_server_url', 'peer_urls', 'peers']

export interface FieldDiff {
  field: string
  expected: unknown
  actual: unknown
}

/**
 * Field-by-field differences between two configs (`parse-config` results), sorted by field:
 * - the four connectivity fields compare as one virtual field `connectivity` (the addresses the
 *   config connects to, `effectivePeers`); it is ignored when any of them is in `ignore`;
 * - unset values (`isUnset`) on both sides are equal; nested objects ignore key order and unset keys;
 * - arrays compare in order.
 * Reported values are the raw ones.
 */
export function diffConfigs(expected: LegacyConfig, actual: LegacyConfig, ignore: Iterable<string>): FieldDiff[] {
  const skip = new Set(ignore)
  const out: FieldDiff[] = []
  if (!CONNECTIVITY_FIELDS.some((f) => skip.has(f))) {
    const a = effectivePeers(expected)
    const b = effectivePeers(actual)
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: 'connectivity', expected: a, actual: b })
  }
  const fields = new Set([...Object.keys(expected), ...Object.keys(actual)])
  for (const f of fields) {
    if (skip.has(f) || CONNECTIVITY_FIELDS.includes(f)) continue
    const a = expected[f]
    const b = actual[f]
    const ua = isUnset(f, a)
    const ub = isUnset(f, b)
    if (ua && ub) continue
    if (!ua && !ub && JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))) continue
    out.push({ field: f, expected: a, actual: b })
  }
  return out.sort((x, y) => x.field.localeCompare(y.field))
}

/**
 * A 2.6.4 core reports its config source as a `[source] source = "webhook"` table, which web
 * v2.7.1's parse-config rejects (it knows `user` / `web`); the table carries no network config.
 */
export function stripSourceTable(toml: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) skipping = /^\s*\[source\]\s*$/.test(line)
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

/** What verification ignores: `instance_id`, `acl` (central ACL lives on the network's ACL tab) and the confirmed changes' fields. */
export function verifyIgnore(confirmed: Iterable<ChangeKey>): Set<string> {
  const out = new Set(['instance_id', 'acl'])
  for (const key of confirmed) for (const f of changeFields(key)) out.add(f)
  return out
}
