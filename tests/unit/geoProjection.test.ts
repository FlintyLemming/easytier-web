import { describe, expect, it } from 'vitest'
import { computeFocus } from '../../src/domain/geo/focus'
import { landDotsPath, makeProjection } from '../../src/domain/geo/projection'

const g = (lon: number, lat: number, total: number) => ({ lon, lat, total })

// The mockup dataset of the computeFocus tests.
const focus = computeFocus([
  g(121.47, 31.23, 7), g(118.78, 32.06, 3), g(116.39, 39.91, 2), g(114.18, 22.31, 2),
  g(114.12, 22.55, 1), g(139.69, 35.69, 1), g(-118.24, 34.05, 1), g(8.68, 50.11, 1),
])
const size = { width: 800, height: 380 }
const SHANGHAI: [number, number] = [121.47, 31.23]
const LOS_ANGELES: [number, number] = [-118.24, 34.05]

/** Inside the area left free by the default inset: [28, 728] × [28, 352]. */
function inInset(p: [number, number] | null): boolean {
  if (!p) return false
  const [x, y] = p
  return x >= 28 && x <= 728 && y >= 28 && y <= 352
}

describe('makeProjection', () => {
  it('fits the focus box into the inset area and leaves far places outside', () => {
    const p = makeProjection(focus, 'focus', size)
    expect(inInset(p(SHANGHAI))).toBe(true)
    expect(inInset(p(LOS_ANGELES))).toBe(false)
  })

  it('shows the whole world in the world view', () => {
    const p = makeProjection(focus, 'world', size)
    expect(inInset(p(SHANGHAI))).toBe(true)
    expect(inInset(p(LOS_ANGELES))).toBe(true)
  })

  it('falls back to the world view without a focus box', () => {
    const p = makeProjection({ centerLon: 120, box: null }, 'focus', size)
    expect(inInset(p(LOS_ANGELES))).toBe(true)
  })
})

describe('landDotsPath', () => {
  it('draws land dots and leaves the open Pacific empty', () => {
    const p = makeProjection(focus, 'world', size)
    const d = landDotsPath(p, size)
    expect(d).not.toBe('')
    expect(d).toMatch(/^M\d+(\.\d)? \d+(\.\d)?h0/)
    const [px, py] = p([-150, 0])!
    const dots = [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h0/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(dots.length).toBeGreaterThan(100)
    expect(dots.filter(([x, y]) => Math.hypot(x! - px, y! - py) < 10)).toEqual([])
  })
})
