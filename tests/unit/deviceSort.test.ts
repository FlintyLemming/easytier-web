import { beforeEach, describe, expect, it } from 'vitest'
import { DEVICE_SORT_STORAGE_KEY, loadDeviceSort, saveDeviceSort } from '../../src/lib/deviceSort'

beforeEach(() => localStorage.clear())

describe('saved device sort', () => {
  it('round-trips a sort', () => {
    saveDeviceSort({ key: 'ip', dir: 'desc' })
    expect(loadDeviceSort()).toEqual({ key: 'ip', dir: 'desc' })
  })
  it('saving the default order removes the entry', () => {
    saveDeviceSort({ key: 'name', dir: 'asc' })
    saveDeviceSort(null)
    expect(localStorage.getItem(DEVICE_SORT_STORAGE_KEY)).toBeNull()
    expect(loadDeviceSort()).toBeNull()
  })
  it('returns null for missing, corrupt or unknown values', () => {
    expect(loadDeviceSort()).toBeNull()
    for (const raw of ['{not json', '[1]', 'null', '{"key":"location","dir":"asc"}', '{"key":"ip","dir":"up"}']) {
      localStorage.setItem(DEVICE_SORT_STORAGE_KEY, raw)
      expect(loadDeviceSort()).toBeNull()
    }
  })
})
