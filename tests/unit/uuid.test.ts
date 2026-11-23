import { describe, expect, it } from 'vitest'
import { strToUuid, uuidToStr } from '../../src/lib/uuid'

describe('uuid helpers', () => {
  it('round trips a uuid string', () => {
    const s = '11111111-1111-4111-8111-111111111111'
    expect(uuidToStr(strToUuid(s))).toBe(s)
  })

  it('round trips an uneven uuid', () => {
    const s = 'f0e1d2c3-b4a5-4968-8776-655443322110'
    expect(uuidToStr(strToUuid(s))).toBe(s)
  })

  it('returns an empty string for null or undefined', () => {
    expect(uuidToStr(null)).toBe('')
    expect(uuidToStr(undefined)).toBe('')
  })

  it('throws on an invalid uuid', () => {
    expect(() => strToUuid('bad')).toThrow()
  })
})
