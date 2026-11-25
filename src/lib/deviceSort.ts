import { SORT_KEYS, type DeviceSort } from '../domain/deviceFilter'

/** The device list's sort, remembered per browser like the UI language. */
export const DEVICE_SORT_STORAGE_KEY = 'et.devices.sort'

/** Never throws: anything missing, corrupt or unknown yields the default order (`null`). */
export function loadDeviceSort(): DeviceSort | null {
  try {
    const raw = localStorage.getItem(DEVICE_SORT_STORAGE_KEY)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    const { key, dir } = v as { key?: unknown; dir?: unknown }
    if (!SORT_KEYS.includes(key as DeviceSort['key'])) return null
    if (dir !== 'asc' && dir !== 'desc') return null
    return { key: key as DeviceSort['key'], dir }
  } catch {
    return null
  }
}

export function saveDeviceSort(sort: DeviceSort | null): void {
  try {
    if (sort) localStorage.setItem(DEVICE_SORT_STORAGE_KEY, JSON.stringify({ key: sort.key, dir: sort.dir }))
    else localStorage.removeItem(DEVICE_SORT_STORAGE_KEY)
  } catch {
    // storage unavailable: the sort still applies for this visit
  }
}
