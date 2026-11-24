import { describe, expect, it } from 'vitest'
import { computeFocus } from '../../src/domain/geo/focus'

const g = (lon: number, lat: number, total: number) => ({ lon, lat, total })

describe('computeFocus', () => {
  it('focuses on the dense core of the mockup dataset', () => {
    const f = computeFocus([
      g(121.47, 31.23, 7), g(118.78, 32.06, 3), g(116.39, 39.91, 2), g(114.18, 22.31, 2),
      g(114.12, 22.55, 1), g(139.69, 35.69, 1), g(-118.24, 34.05, 1), g(8.68, 50.11, 1),
    ])
    expect(f.centerLon).toBe(120)
    const b = f.box!
    expect(b).not.toBeNull()
    expect(b.dLonMin).toBeLessThanOrEqual(114.12 - 120)
    expect(b.dLonMax).toBeGreaterThanOrEqual(139.69 - 120)
    expect(b.dLonMax).toBeLessThan(100)
    expect(b.dLonMin).toBeGreaterThan(-100)
  })

  it('expands a single group to the minimum span, centered on it', () => {
    const f = computeFocus([g(104.2, 35.9, 5)])
    const b = f.box!
    expect(b.dLonMax - b.dLonMin).toBeCloseTo(20)
    expect(b.latMax - b.latMin).toBeCloseTo(12)
    expect((b.dLonMin + b.dLonMax) / 2).toBeCloseTo(104.2 - f.centerLon)
    expect((b.latMin + b.latMax) / 2).toBeCloseTo(35.9)
  })

  it('has no box when the groups are too spread out', () => {
    expect(computeFocus([g(121.47, 31.23, 1), g(-118.24, 34.05, 1)]).box).toBeNull()
  })

  it('handles no groups', () => {
    expect(computeFocus([])).toEqual({ centerLon: 0, box: null })
  })

  it('keeps longitudes continuous across the antimeridian', () => {
    const b = computeFocus([g(178, -18, 1), g(-172, -14, 1)]).box!
    expect(b.dLonMax - b.dLonMin).toBeCloseTo(20)
  })
})
