import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { PeerLink } from '../domain/connections'
import { useRuntime } from '../stores/runtime'
import { usePolling } from './usePolling'

const INTERVAL_MS = 15_000

/**
 * Live links of one device in one network (its central instance id == network id), polled every
 * 15 s via proxy-rpc while the device is online. Routes and peers live in the shared runtime store, so
 * links the overview already fetched show at once; members, temporary peers and names come from the
 * inventory store (polled every 5 s by the shell), so labels stay current between polls. Offline or
 * without a network it sends nothing and `links` stays null.
 */
export function useDeviceRuntime(
  deviceId: Ref<string>,
  networkId: Ref<string | null>,
  online: Ref<boolean>,
): { links: Ref<PeerLink[] | null>; error: Ref<string | null>; loading: Ref<boolean>; retry(): void } {
  const runtime = useRuntime()
  const loading = ref(false)

  /** The (device, network) being watched, or null while offline / without a network. */
  const target = computed(() => {
    const dev = deviceId.value
    const net = networkId.value
    return online.value && dev && net ? { dev, net } : null
  })
  const links = computed<PeerLink[] | null>(() => {
    const t = target.value
    return t ? runtime.linksFor(t.dev, t.net) : null
  })
  const error = computed<string | null>(() => {
    const t = target.value
    return t ? (runtime.errors[runtime.runtimeKey(t.dev, t.net)] ?? null) : null
  })

  /** Bumped on every (re)start; an older generation's fetch no longer drives `loading`. */
  let generation = 0
  let poller: { start(): void; stop(): void } | null = null

  async function fetchOnce(gen: number, dev: string, net: string): Promise<void> {
    loading.value = true
    try {
      await runtime.fetch(dev, net)
    } finally {
      if (gen === generation) loading.value = false
    }
  }

  function stop() {
    generation++
    poller?.stop()
    poller = null
  }

  function restart() {
    stop()
    const t = target.value
    if (!t) {
      loading.value = false
      return
    }
    const gen = generation
    poller = usePolling(() => fetchOnce(gen, t.dev, t.net), INTERVAL_MS)
    poller.start()
  }

  watch([deviceId, networkId, online], restart, { immediate: true })
  onScopeDispose(stop)

  /** Fetch now; a fetch already in flight counts as the retry. */
  function retry() {
    if (loading.value) return
    const t = target.value
    if (t) runtime.clearError(t.dev, t.net)
    restart()
  }

  return { links, error, loading, retry }
}
