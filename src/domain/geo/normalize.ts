// Erasable-only TS and no imports: also run directly by scripts/build-geo.ts under Node.

export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

// 「州」 is deliberately absent: it would turn 杭州 / 广州 into 杭 / 广.
const SUFFIXES = [
  '特别行政区',
  '维吾尔自治区',
  '壮族自治区',
  '回族自治区',
  '自治区',
  '自治州',
  '地区',
  '省',
  '市',
  '都',
  '府',
  '县',
]

export function nameKeys(s: string): string[] {
  const keys = [normalizeName(s)]
  if (/\p{Script=Han}/u.test(s)) {
    const trimmed = s.trim()
    for (const suffix of SUFFIXES) {
      if (trimmed.endsWith(suffix) && trimmed.length - suffix.length >= 2) {
        keys.push(normalizeName(trimmed.slice(0, -suffix.length)))
        break
      }
    }
  }
  return [...new Set(keys)]
}
