import { geoNaturalEarth1, type GeoProjection } from 'd3-geo'
import { MAP_LAT_RANGE, type MapFocus } from './focus'
import { isLand } from './landMask'

export type MapView = 'focus' | 'world'
export interface MapInset { top: number; right: number; bottom: number; left: number }
/** Room around the fitted area; the wider right side leaves space for the dot labels. */
export const MAP_INSET: MapInset = { top: 28, right: 72, bottom: 28, left: 28 }

type Size = { width: number; height: number }

/** a, a + step, … up to and including b. */
function steps(a: number, b: number, step: number): number[] {
  const out: number[] = []
  for (let v = a; v < b; v += step) out.push(v)
  out.push(b)
  return out
}

function fitPoints(focus: MapFocus, view: MapView): [number, number][] {
  const box = view === 'focus' ? focus.box : null
  const points: [number, number][] = []
  if (!box) {
    for (const dLon of steps(-179.9, 179.9, 10)) {
      for (const lat of steps(MAP_LAT_RANGE[0], MAP_LAT_RANGE[1], 10)) points.push([focus.centerLon + dLon, lat])
    }
    return points
  }
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      points.push([
        focus.centerLon + box.dLonMin + ((box.dLonMax - box.dLonMin) * i) / 4,
        box.latMin + ((box.latMax - box.latMin) * j) / 4,
      ])
    }
  }
  return points
}

/** Natural Earth centred on `focus.centerLon`, fitted to the focus box (or the world) inside `inset`. */
export function makeProjection(focus: MapFocus, view: MapView, size: Size, inset: MapInset = MAP_INSET): GeoProjection {
  return geoNaturalEarth1()
    .rotate([-focus.centerLon, 0])
    .fitExtent(
      [[inset.left, inset.top], [size.width - inset.right, size.height - inset.bottom]],
      { type: 'MultiPoint', coordinates: fitPoints(focus, view) },
    )
}

const f1 = (n: number) => String(Math.round(n * 10) / 10)

/** One zero-length segment per land pixel of a `spacing` grid; draw with a round line cap. */
export function landDotsPath(projection: GeoProjection, size: Size, spacing = 7): string {
  const parts: string[] = []
  const invert = projection.invert!
  for (let y = spacing / 2; y < size.height; y += spacing) {
    for (let x = spacing / 2; x < size.width; x += spacing) {
      const ll = invert([x, y])
      if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1]) || !isLand(ll[0], ll[1])) continue
      // invert() also answers for pixels off the globe; those do not project back onto themselves.
      const back = projection(ll)
      if (!back || Math.hypot(back[0] - x, back[1] - y) >= 1) continue
      parts.push(`M${f1(x)} ${f1(y)}h0`)
    }
  }
  return parts.join('')
}
