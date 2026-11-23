import { describe, expect, it } from 'vitest'
import { compareVersions, isOutdated, latestVersion, parseVersion } from '../../src/domain/version'

describe('version', () => {
  it('parses x.y.z before the dash', () => {
    expect(parseVersion('2.6.4-8428a89d')).toEqual([2, 6, 4])
    expect(parseVersion('garbage')).toBeNull()
  })
  it('compares', () => {
    expect(compareVersions('2.7.1', '2.6.4-x')).toBeGreaterThan(0)
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0)
  })
  it('isOutdated', () => {
    expect(isOutdated('2.6.4-8428a89d', '2.7.1')).toBe(true)
    expect(isOutdated('2.7.1-abc', '2.7.1')).toBe(false)
    expect(isOutdated('garbage', '2.7.1')).toBe(false)
    expect(isOutdated('2.6.4', null)).toBe(false)
  })
  it('latestVersion', () => {
    expect(latestVersion(['2.6.4-x', '2.7.1', 'garbage'])).toBe('2.7.1')
    expect(latestVersion(['garbage'])).toBeNull()
    expect(latestVersion([])).toBeNull()
  })
})
