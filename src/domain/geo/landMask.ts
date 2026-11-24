import { LAND_MASK } from '../../generated/geo/landMask'

let bytes: Uint8Array | undefined

function decode(): Uint8Array {
  if (!bytes) {
    const bin = atob(LAND_MASK.bits)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    bytes = out
  }
  return bytes
}

export function isLand(lon: number, lat: number): boolean {
  const { width, height } = LAND_MASK
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  const clamped = Math.min(90, Math.max(-90, lat))
  const col = Math.min(width - 1, Math.floor((wrapped + 180) / 0.5))
  const row = Math.min(height - 1, Math.floor((90 - clamped) / 0.5))
  const i = row * width + col
  return ((decode()[i >> 3]! >> (7 - (i & 7))) & 1) === 1
}
