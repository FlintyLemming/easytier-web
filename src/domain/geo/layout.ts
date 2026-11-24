export interface ScreenPoint { key: string; label: string; x: number; y: number; total: number; online: number }
export interface MapCluster {
  id: string; x: number; y: number; r: number; total: number; online: number; keys: string[]; labels: string[]
}
export interface EdgeChip {
  side: 'left' | 'right' | 'top' | 'bottom'; pos: number; total: number; keys: string[]; labels: string[]
}
export interface MapArc { from: string; to: string; d: string; dashed: boolean }

export function dotRadius(total: number): number {
  if (total <= 1) return 4.5
  return Math.min(22, Math.max(8, 4.5 * Math.sqrt(total)))
}

export function clusterPoints(points: ScreenPoint[]): MapCluster[] {
  const sorted = [...points].sort((a, b) => b.total - a.total || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  const clusters: MapCluster[] = []
  for (const p of sorted) {
    const hit = clusters.find(
      (c) => Math.hypot(c.x - p.x, c.y - p.y) < dotRadius(c.total) + dotRadius(p.total) + 4,
    )
    if (hit) {
      hit.keys.push(p.key)
      hit.labels.push(p.label)
      hit.total += p.total
      hit.online += p.online
    } else {
      clusters.push({ id: p.key, x: p.x, y: p.y, r: 0, total: p.total, online: p.online, keys: [p.key], labels: [p.label] })
    }
  }
  for (const c of clusters) c.r = dotRadius(c.total)
  return clusters
}

export function edgeChips(outside: ScreenPoint[], size: { width: number; height: number }): EdgeChip[] {
  const hw = size.width / 2
  const hh = size.height / 2
  const clamp = (v: number, len: number) => Math.min(Math.max(v, 20), len - 20)
  const raw: (EdgeChip & { label: string; key: string })[] = []
  for (const p of outside) {
    const dx = p.x - hw
    const dy = p.y - hh
    const tx = dx === 0 ? Infinity : hw / Math.abs(dx)
    const ty = dy === 0 ? Infinity : hh / Math.abs(dy)
    let side: EdgeChip['side']
    let pos: number
    if (tx <= ty) {
      side = dx > 0 ? 'right' : 'left'
      pos = clamp(hh + dy * tx, size.height)
    } else {
      side = dy > 0 ? 'bottom' : 'top'
      pos = clamp(hw + dx * ty, size.width)
    }
    raw.push({ side, pos, total: p.total, keys: [p.key], labels: [p.label], label: p.label, key: p.key })
  }
  const chips: EdgeChip[] = []
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const list = raw.filter((c) => c.side === side).sort((a, b) => a.pos - b.pos)
    let prev: EdgeChip | null = null
    for (const c of list) {
      if (prev && c.pos - prev.pos < 28) {
        prev.total += c.total
        prev.keys.push(...c.keys)
        prev.labels.push(...c.labels)
      } else {
        prev = { side, pos: c.pos, total: c.total, keys: [...c.keys], labels: [...c.labels] }
        chips.push(prev)
      }
    }
  }
  return chips
}

const f1 = (n: number) => String(Math.round(n * 10) / 10)

export function buildArcs(
  clusters: MapCluster[],
  pairs: { a: string; b: string; direct: boolean }[],
  groupOf: Record<string, string>,
): MapArc[] {
  const clusterOfKey = new Map<string, MapCluster>()
  const order = new Map<string, number>()
  clusters.forEach((c, i) => {
    order.set(c.id, i)
    for (const k of c.keys) clusterOfKey.set(k, c)
  })
  const acc = new Map<string, { from: MapCluster; to: MapCluster; direct: number; relay: number }>()
  for (const p of pairs) {
    const ga = groupOf[p.a]
    const gb = groupOf[p.b]
    if (ga === undefined || gb === undefined) continue
    const ca = clusterOfKey.get(ga)
    const cb = clusterOfKey.get(gb)
    if (!ca || !cb || ca === cb) continue
    const [from, to] = order.get(ca.id)! < order.get(cb.id)! ? [ca, cb] : [cb, ca]
    const k = `${from.id}\u0000${to.id}`
    let e = acc.get(k)
    if (!e) acc.set(k, (e = { from, to, direct: 0, relay: 0 }))
    if (p.direct) e.direct++
    else e.relay++
  }
  return [...acc.values()].map(({ from, to, direct, relay }) => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    // Perpendicular unit vector, picked so that it points towards smaller y (upwards).
    let nx = dy / len
    let ny = -dx / len
    if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny }
    const cx = (from.x + to.x) / 2 + nx * 0.2 * len
    const cy = (from.y + to.y) / 2 + ny * 0.2 * len
    return {
      from: from.id,
      to: to.id,
      d: `M ${f1(from.x)} ${f1(from.y)} Q ${f1(cx)} ${f1(cy)} ${f1(to.x)} ${f1(to.y)}`,
      dashed: relay >= direct,
    }
  })
}
