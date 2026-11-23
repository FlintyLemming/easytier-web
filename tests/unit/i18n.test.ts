import { describe, expect, it } from 'vitest'
import zh from '../../src/i18n/zh-CN'
import en from '../../src/i18n/en'

function keys(o: Record<string, unknown>, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, p + k + '.') : [p + k],
  )
}

describe('i18n catalogs', () => {
  it('zh-CN and en have identical keys', () => {
    expect(keys(en).sort()).toEqual(keys(zh).sort())
  })
})
