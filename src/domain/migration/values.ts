import { declaredDefault, isDefaultValue } from '../../lib/networkConfig'
import type { LegacyConfig } from './types'

/**
 * A value that states nothing: empty (null, '', [], {}), the flag's declared default, or `false`
 * for a flag without a declared default (proto3 bools default to false; web v2.7.1 generate-config
 * writes such flags out explicitly while a running TOML omits them — Task 1 fixtures).
 */
export function isUnset(field: string, value: unknown): boolean {
  if (isDefaultValue(field, value)) return true
  if (value === false && declaredDefault(field) === undefined) return true
  if (value && typeof value === 'object' && !Array.isArray(value)) return normalizeObject(value as LegacyConfig) === undefined
  return false
}

/** Nested objects lose their unset keys (key order is irrelevant); undefined when nothing is left. */
function normalizeObject(o: LegacyConfig): LegacyConfig | undefined {
  const out: LegacyConfig = {}
  for (const k of Object.keys(o).sort()) {
    const v = normalize(o[k])
    if (v === undefined || v === null || v === '' || v === false) continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

export function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') return normalizeObject(v as LegacyConfig)
  return v
}

