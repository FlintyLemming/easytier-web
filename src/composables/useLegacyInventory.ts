import { ref } from 'vue'
import { getInstanceConfig, instanceMetas, listInstances, nodeInfo } from '../api/client'
import { isLegacyId } from '../domain/migration/inventory'
import { manualRoutesOf, readManualRoutes, restoreManualRoutes } from '../domain/migration/manualRoutes'
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

  /**
   * One device's legacy instances. Metas only name the network, so a failed metas read falls back
   * to the configs; an instance whose config cannot be read is left out and reported in `error`
   * (the device is listed under 读取失败 with the others still shown).
   */
  async function readDevice(device: DeviceRef): Promise<{ instances: LegacyInstance[]; error: string | null }> {
    const list = await listInstances(device.id)
    const ids = [...new Set([...list.running, ...list.disabled])].filter((id) => isLegacyId(id, inventory.networks))
    if (ids.length === 0) return { instances: [], error: null }
    let metas: Awaited<ReturnType<typeof instanceMetas>> = {}
    try {
      metas = await instanceMetas(device.id, ids)
    } catch { /* names come from the configs */ }
    const out: LegacyInstance[] = []
    let error: string | null = null
    for (const id of ids) {
      let config: Record<string, unknown>
      try {
        config = await getInstanceConfig(device.id, id)
      } catch (e) {
        error = message(e)
        continue
      }
      const running = list.running.includes(id)
      // A 2.6.4 core's config view drops the manual-routes mode of `routes = []`; its running TOML
      // keeps it (manualRoutes.ts). Unknown when it cannot be read: the run reads it again before
      // disabling and does not start without it. A disabled instance's stored config is exact.
      let manualRoutes: string[] | null | undefined = running ? undefined : manualRoutesOf(config)
      if (running) {
        try {
          const r = readManualRoutes((await nodeInfo(device.id, id)).config, id)
          if (r.known) {
            manualRoutes = r.routes
            config = restoreManualRoutes(config, r.routes)
          }
        } catch { /* unknown */ }
      }
      const networkName = metas[id]?.networkName || (typeof config.network_name === 'string' ? config.network_name : '')
      out.push({ deviceId: device.id, instanceId: id, networkName, running, config, manualRoutes })
    }
    return { instances: out, error }
  }

  let inflight: Promise<void> | null = null

  async function doLoad(): Promise<void> {
    loading.value = true
    try {
      // Always fresh: a network created since (or members added) changes what counts as legacy.
      await inventory.refresh()
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
            const r = await readDevice(d)
            found.push(...r.instances)
            if (r.error) errors.push({ device: d, message: r.error })
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

  /** Devices being read again (their 重试 shows a loading state). */
  const retrying = ref<string[]>([])

  /** Reads one device again; a full success replaces its instances and clears its failure. */
  async function retry(deviceId: string): Promise<void> {
    const device = devices.value.get(deviceId)
    if (!device || retrying.value.includes(deviceId)) return
    retrying.value = [...retrying.value, deviceId]
    try {
      const r = await readDevice(device)
      instances.value = [...instances.value.filter((i) => i.deviceId !== deviceId), ...r.instances]
      failed.value = r.error
        ? failed.value.map((f) => (f.device.id === deviceId ? { device, message: r.error! } : f))
        : failed.value.filter((f) => f.device.id !== deviceId)
    } catch (e) {
      failed.value = failed.value.map((f) => (f.device.id === deviceId ? { device, message: message(e) } : f))
    } finally {
      retrying.value = retrying.value.filter((x) => x !== deviceId)
    }
  }

  return { loading, progress, instances, offline, failed, devices, retrying, load, retry }
}
