import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { instanceInfo, instanceMetas, listInstances } from '../api/client'
import type { InstanceMeta, InstanceRunningInfo } from '../api/types'
import { errorMessage } from '../components/device-detail/writes'
import type { DeviceView } from '../domain/devices'
import { buildInstanceRows, manualInstanceIds, type InstanceRow } from '../domain/instances'
import { usePolling } from './usePolling'

const POLL_MS = 5_000

export interface InstanceRows {
  /** null until the first successful read. */
  rows: Ref<InstanceRow[] | null>
  /** The running info of each listed running instance, as last read (the VPN Portal dialog reads it). */
  infos: ShallowRef<Record<string, InstanceRunningInfo | null>>
  /** The last read's failure (the list itself could not be read), or null. */
  loadError: Ref<string | null>
  retrying: Ref<boolean>
  online: ComputedRef<boolean>
  /**
   * Reads now, for an action that just wrote: when a read is already under way (it may predate the
   * write), one more read follows it instead of a second one in parallel. Resolves once a read that
   * started after this call has finished.
   */
  refreshNow(): Promise<void>
  retry(): Promise<void>
  /** The instance is gone: forget its meta. */
  dropMeta(id: string): void
  /** The instance's meta may have changed (an edit): ask again, showing the cached one until then. */
  rereadMeta(id: string): void
}

/**
 * The manual instances of one device (spec §6.7), polled every 5 s while it is online:
 * listInstances → manualInstanceIds → instanceMetas for ids not cached yet → instanceInfo per
 * instance that is not disabled → buildInstanceRows. An offline device is asked nothing.
 *
 * Reads are single-flight: the poller, retry and every action go through one entry point, so at
 * most one read (and so one request of each kind) is in flight at any time.
 */
export function useInstanceRows(device: () => DeviceView, centralIds: () => string[]): InstanceRows {
  const rows = ref<InstanceRow[] | null>(null)
  const infos = shallowRef<Record<string, InstanceRunningInfo | null>>({})
  const loadError = ref<string | null>(null)
  const retrying = ref(false)
  const online = computed(() => device().online)

  /** Metas only change through an edit or a delete here, which reread or drop the entry. */
  const metas: Record<string, InstanceMeta> = {}
  const staleMetas = new Set<string>()

  /**
   * Bumped per read, when the device goes offline and on unmount. A read checks it after every
   * await: once it is no longer current (the device went offline, or the panel is gone) it stops,
   * sending nothing more and applying nothing.
   */
  let seq = 0
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    seq++
  })

  async function read(): Promise<void> {
    // An offline device is not asked anything, and neither is one whose panel is gone.
    if (disposed || !device().online) return
    const machineId = device().id
    const mine = ++seq
    // Only the list decides whether the read failed; the rest degrades per instance.
    let ids: { id: string; disabled: boolean }[]
    try {
      ids = manualInstanceIds(await listInstances(machineId), centralIds())
    } catch (e) {
      if (mine === seq) loadError.value = errorMessage(e)
      return
    }
    if (mine !== seq) return
    const ask = ids.map((i) => i.id).filter((id) => !metas[id] || staleMetas.has(id))
    if (ask.length) {
      let fetched: Record<string, InstanceMeta> = {}
      try {
        fetched = await instanceMetas(machineId, ask)
      } catch {
        // Not cached yet: those rows show their id as the name, without 编辑 or 删除…, and the next
        // read asks again. A cached meta keeps being used.
      }
      if (mine !== seq) return
      for (const [id, meta] of Object.entries(fetched)) {
        metas[id] = meta
        staleMetas.delete(id)
      }
    }
    const last = infos.value
    const next: Record<string, InstanceRunningInfo | null> = {}
    await Promise.all(
      ids.filter((i) => !i.disabled).map(async ({ id }) => {
        try {
          next[id] = await instanceInfo(machineId, id)
        } catch {
          // One unreadable instance keeps its last info (none yet shows 启动中); the others still update.
          next[id] = last[id] ?? null
        }
      }),
    )
    if (mine !== seq) return
    infos.value = next
    rows.value = buildInstanceRows(ids, metas, next)
    loadError.value = null
  }

  // --- single flight ---

  /** The read under way, if any. */
  let current: Promise<void> | null = null
  /** A read asked for while `current` runs; it starts as soon as `current` ends. */
  let queued: { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } | null = null

  function start(): Promise<void> {
    const run = (async () => {
      try {
        await read()
      } finally {
        current = null
        const next = queued
        queued = null
        // Started synchronously here, so nothing can slip in between the two reads.
        if (next) start().then(next.resolve, next.reject)
      }
    })()
    current = run
    return run
  }

  function refreshNow(): Promise<void> {
    if (!current) return start()
    if (!queued) {
      let resolve!: () => void
      let reject!: (e: unknown) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      queued = { promise, resolve, reject }
    }
    return queued.promise
  }

  /** A poll tick joins a read under way: that read is as fresh as the tick needs. */
  function poll(): Promise<void> {
    return current ?? start()
  }

  async function retry(): Promise<void> {
    retrying.value = true
    try {
      await refreshNow()
    } finally {
      retrying.value = false
    }
  }

  const poller = usePolling(poll, POLL_MS)
  // An offline device is not asked anything; it is read again as soon as it is back.
  watch(
    online,
    (on) => {
      if (on) {
        // A read cut short by going offline may still be waiting for its answer: read again after it.
        if (current) void refreshNow()
        poller.start()
      } else {
        poller.stop()
        seq++
      }
    },
    { immediate: true },
  )

  return {
    rows,
    infos,
    loadError,
    retrying,
    online,
    refreshNow,
    retry,
    dropMeta(id) {
      delete metas[id]
      staleMetas.delete(id)
    },
    rereadMeta(id) {
      staleMetas.add(id)
    },
  }
}
