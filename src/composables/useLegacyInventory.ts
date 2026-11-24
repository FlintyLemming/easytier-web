import { ref } from 'vue'
import { getInstanceConfig, instanceMetas, listInstances } from '../api/client'
import { isLegacyId } from '../domain/migration/inventory'
import type { DeviceRef, LegacyInstance } from '../domain/migration/types'
import { useInventory } from '../stores/inventory'

/** At most this many devices are read at once (each device's own reads run one after another). */
const DEVICE_CONCURRENCY = 4

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The legacy instances of every online device (spec §5.10.2 step 1). Read on demand by the
 * migration page, not polled: per device the instance list, the metas, then each legacy config.
 */
export function useLegacyInventory() {
  const inventory = useInventory()
  const loading = ref(false)
  const progress = ref({ done: 0, total: 0 })
  const instances = ref<LegacyInstance[]>([])
  const offline = ref<DeviceRef[]>([])
  const failed = ref<{ device: DeviceRef; message: string }[]>([])
  const devices = ref(new Map<string, DeviceRef>())

  function deviceRefs(): DeviceRef[] {
    return inventory.devices
      .filter((d) => !d.pending)
      .map((d) => ({ id: d.id, name: d.name, hostname: d.hostname, online: d.online }))
  }

  async function readDevice(device: DeviceRef): Promise<LegacyInstance[]> {
    const list = await listInstances(device.id)
    const ids = [...new Set([...list.running, ...list.disabled])].filter((id) => isLegacyId(id, inventory.networks))
    if (ids.length === 0) return []
    const metas = await instanceMetas(device.id, ids)
    const out: LegacyInstance[] = []
    for (const id of ids) {
      const config = await getInstanceConfig(device.id, id)
      const networkName = metas[id]?.networkName || (typeof config.network_name === 'string' ? config.network_name : '')
      out.push({ deviceId: device.id, instanceId: id, networkName, running: list.running.includes(id), config })
    }
    return out
  }

  let inflight: Promise<void> | null = null

  async function doLoad(): Promise<void> {
    loading.value = true
    try {
      if (!inventory.loaded) await inventory.refresh()
      const refs = deviceRefs()
      devices.value = new Map(refs.map((d) => [d.id, d]))
      offline.value = refs.filter((d) => !d.online)
      const online = refs.filter((d) => d.online)
      progress.value = { done: 0, total: online.length }
      const found: LegacyInstance[] = []
      const errors: { device: DeviceRef; message: string }[] = []
      const queue = [...online]
      async function worker() {
        for (let d = queue.shift(); d; d = queue.shift()) {
          try {
            found.push(...(await readDevice(d)))
          } catch (e) {
            errors.push({ device: d, message: message(e) })
          }
          progress.value = { ...progress.value, done: progress.value.done + 1 }
        }
      }
      await Promise.all(Array.from({ length: Math.min(DEVICE_CONCURRENCY, queue.length) }, worker))
      instances.value = found
      failed.value = errors
    } finally {
      loading.value = false
    }
  }

  /** Reads every online device again (single flight). */
  function load(): Promise<void> {
    if (!inflight) inflight = doLoad().finally(() => (inflight = null))
    return inflight
  }

  /** Reads one device again; a success replaces its instances and clears its failure. */
  async function retry(deviceId: string): Promise<void> {
    const device = devices.value.get(deviceId)
    if (!device) return
    try {
      const mine = await readDevice(device)
      instances.value = [...instances.value.filter((i) => i.deviceId !== deviceId), ...mine]
      failed.value = failed.value.filter((f) => f.device.id !== deviceId)
    } catch (e) {
      failed.value = failed.value.map((f) => (f.device.id === deviceId ? { device, message: message(e) } : f))
    }
  }

  return { loading, progress, instances, offline, failed, devices, load, retry }
}
