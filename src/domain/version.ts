export function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((v ?? '').split('-')[0]!.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Compares x.y.z parts; unparsable versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  }
  return 0
}

export function latestVersion(vs: string[]): string | null {
  let best: string | null = null
  for (const v of vs) {
    if (!parseVersion(v)) continue
    if (best === null || compareVersions(v, best) > 0) best = v
  }
  return best
}

export function isOutdated(v: string, latest: string | null): boolean {
  if (!latest || !parseVersion(v)) return false
  return compareVersions(v, latest) < 0
}
