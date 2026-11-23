// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later
// Source: easytier-web/frontend-lib/src/modules/utils.ts (UuidToStr / StrToUuid and helpers).

export interface UUID {
  part1?: number
  part2?: number
  part3?: number
  part4?: number
}

function toHexString(uint64: bigint, padding = 9): string {
  let hexString = uint64.toString(16)
  while (hexString.length < padding) {
    hexString = '0' + hexString
  }
  return hexString
}

function uint32ToUuid(part1: number, part2: number, part3: number, part4: number): string {
  const part1Hex = toHexString(BigInt(part1), 8)
  const part2Hex = toHexString(BigInt(part2), 8)
  const part3Hex = toHexString(BigInt(part3), 8)
  const part4Hex = toHexString(BigInt(part4), 8)

  return `${part1Hex.substring(0, 8)}-${part2Hex.substring(0, 4)}-${part2Hex.substring(4, 8)}-${part3Hex.substring(0, 4)}-${part3Hex.substring(4, 8)}${part4Hex.substring(0, 12)}`
}

export function uuidToStr(uuid: UUID | null | undefined): string {
  if (!uuid) {
    return ''
  }
  return uint32ToUuid(uuid.part1 ?? 0, uuid.part2 ?? 0, uuid.part3 ?? 0, uuid.part4 ?? 0)
}

export function strToUuid(uuid: string): { part1: number; part2: number; part3: number; part4: number } {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID: ${uuid}`)
  }

  return {
    part1: Number.parseInt(hex.slice(0, 8), 16),
    part2: Number.parseInt(hex.slice(8, 16), 16),
    part3: Number.parseInt(hex.slice(16, 24), 16),
    part4: Number.parseInt(hex.slice(24, 32), 16),
  }
}
