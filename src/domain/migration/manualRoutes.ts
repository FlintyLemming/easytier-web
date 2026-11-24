import type { LegacyConfig } from './types'

/**
 * EasyTier routing has three states (upstream docs/core-architecture.md): no `routes` = automatic,
 * `routes = []` = install no remote subnet routes, a list = explicit routes. A released 2.6.4 core
 * reports `routes = []` in its config view without the manual-mode flag (`enable_manual_routes`),
 * web v2.7.1 returns that view for a running instance, and disabling an instance stores it — so
 * the mode is lost unless it is read back from the running TOML (as web v2.7.1 itself does in
 * `runtime_reconcile.rs restore_manual_routes_from_toml`).
 */

/** The top-level `routes` of a TOML (before any table): null when absent. */
export function manualRoutesFromToml(toml: string): string[] | null {
  const lines = toml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*\[/.test(line)) return null
    const m = /^\s*routes\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let text = m[1]!
    while (!text.includes(']') && i + 1 < lines.length) text += '\n' + lines[++i]
    return [...text.matchAll(/"([^"]*)"/g)].map((x) => x[1]!)
  }
  return null
}

/** The routes of a config in manual mode; null when routing is automatic. */
export function manualRoutesOf(config: LegacyConfig): string[] | null {
  if (config.enable_manual_routes !== true) return null
  return Array.isArray(config.routes) ? config.routes.filter((r): r is string => typeof r === 'string') : []
}

/** The config with the manual mode put back when the core runs manual routes; otherwise unchanged. */
export function restoreManualRoutes(config: LegacyConfig, routes: string[] | null): LegacyConfig {
  if (routes === null || config.enable_manual_routes === true) return config
  return { ...config, enable_manual_routes: true, routes }
}
