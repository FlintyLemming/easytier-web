import { describe, expect, it } from 'vitest'
import { buildArcs, clusterPoints, dotRadius, edgeChips, type MapCluster, type ScreenPoint } from '../../src/domain/geo/layout'

const pt = (key: string, x: number, y: number, total = 1, online = total): ScreenPoint => ({ key, label: key, x, y, total, online })

describe('dotRadius', () => {
  it('scales with the square root and clamps', () => {
    expect(dotRadius(1)).toBe(4.5)
    expect(dotRadius(2)).toBe(8)
    expect(dotRadius(10)).toBeCloseTo(14.23, 2)
    expect(dotRadius(100)).toBe(22)
  })
})

describe('clusterPoints', () => {
  it('merges close points onto the bigger one', () => {
    const c = clusterPoints([pt('small', 106, 100, 1), pt('big', 100, 100, 2)])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ id: 'big', x: 100, y: 100, total: 3, labels: ['big', 'small'], keys: ['big', 'small'] })
    expect(c[0]!.r).toBeCloseTo(dotRadius(3))
  })
  it('keeps distant points apart', () => {
    expect(clusterPoints([pt('a', 100, 100, 2), pt('b', 160, 100)])).toHaveLength(2)
  })
})

describe('edgeChips', () => {
  const size = { width: 800, height: 400 }
  it('projects onto the crossed edge', () => {
    const [r] = edgeChips([pt('r', 1200, 180)], size)
    expect(r).toMatchObject({ side: 'right' })
    expect(r!.pos).toBeCloseTo(190)
    const [l] = edgeChips([pt('l', -300, 200)], size)
    expect(l).toMatchObject({ side: 'left', pos: 200 })
  })
  it('handles top and bottom and clamps', () => {
    expect(edgeChips([pt('t', 400, -500)], size)[0]).toMatchObject({ side: 'top', pos: 400 })
    expect(edgeChips([pt('b', 900, 2000)], size)[0]!.side).toBe('bottom')
    expect(edgeChips([pt('c', 1200, -1000)], size)[0]!.pos).toBeGreaterThanOrEqual(20)
  })
  it('merges neighbours on one edge', () => {
    const chips = edgeChips([pt('a', 1200, 170, 2), pt('b', 1200, 200, 1)], size)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ total: 3, keys: ['a', 'b'], labels: ['a', 'b'] })
  })
})

describe('buildArcs', () => {
  const cl = (id: string, x: number, y: number): MapCluster => ({ id, x, y, r: 5, total: 1, online: 1, keys: [id], labels: [id] })
  const clusters = [cl('A', 0, 100), cl('B', 100, 100), cl('C', 200, 100)]
  const groupOf = { a1: 'A', a2: 'A', b1: 'B', c1: 'C', z: 'Z' }
  const pairs = [
    { a: 'a1', b: 'b1', direct: true }, { a: 'a2', b: 'b1', direct: false },
    { a: 'a1', b: 'c1', direct: true }, { a: 'a2', b: 'c1', direct: true }, { a: 'b1', b: 'c1', direct: false },
    { a: 'a1', b: 'a2', direct: true },
    { a: 'a1', b: 'z', direct: true }, { a: 'a1', b: 'nope', direct: true },
  ]
  it('counts per cluster pair', () => {
    const arcs = buildArcs(clusters, pairs.slice(0, 4), groupOf)
    expect(arcs.find((a) => a.from === 'A' && a.to === 'B')!.dashed).toBe(true)
    expect(arcs.find((a) => a.from === 'A' && a.to === 'C')!.dashed).toBe(false)
  })
  it('skips same-cluster and unknown ends, and arcs upwards', () => {
    const arcs = buildArcs(clusters, pairs, groupOf)
    expect(arcs).toHaveLength(3)
    const d = arcs.find((a) => a.from === 'A' && a.to === 'B')!.d
    expect(d.startsWith('M')).toBe(true)
    const m = /Q ([\d.-]+) ([\d.-]+)/.exec(d)!
    expect(Number(m[2])).toBeLessThan(100)
    expect(d).toBe('M 0 100 Q 50 80 100 100')
  })
})
