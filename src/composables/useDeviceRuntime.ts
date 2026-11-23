import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { nodePeers, nodeRoutes } from '../api/client'
import type { NodePeerInfo, NodeRouteInfo } from '../api/types'
import { classifyPeers, type PeerLink } from '../domain/connections'
import { useInventory } from '../stores/inventory'
import { usePolling } from './usePolling'

const INTERVAL_MS = 15_000

/**
 * Live links of one device in one network (its central instance id == network id), polled every
 * 15 s via proxy-rpc while the device is online. Members and temporary peers come from the inventory
 * store (polled every 5 s by the shell), so labels stay current between polls. Offline or without a
 * network it sends nothing and `links` stays null.
 */
export function useDeviceRuntime(
  deviceId: Ref<string>,
  networkId: Ref<string | null>,
  online: Ref<boolean>,
): { links: Ref<PeerLink[] | null>; error: Ref<string | null>; loading: Ref<boolean>; retry(): void } {
  const inventory = useInventory()
  const raw = shallowRef<{ networkId: string; routes: NodeRouteInfo[]; peers: NodePeerInfo[] } | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  /** Bumped on every (re)start; results from an older generation are dropped. */
  let generation = 0
  let poller: { start(): void; stop(): void } | null = null

  const links = computed<PeerLink[] | null>(() => {
    const r = raw.value
    if (!r) return null
    const deviceNames: Record<string, string> = {}
    for (const d of inventory.devices) deviceNames[d.id] = d.name
    return classifyPeers({
      routes: r.routes,
      peers: r.peers,
      members: inventory.membersByNetwork[r.networkId] ?? [],
      temporaryPeers: inventory.temporaryByNetwork[r.networkId] ?? [],
      deviceNames,
    })
  })

  async function fetchOnce(gen: number, dev: string, net: string): Promise<void> {
    loading.value = true
    try {
      const [routes, peers] = await Promise.all([nodeRoutes(dev, net), nodePeers(dev, net)])
      if (gen !== generation) return
      raw.value = { networkId: net, routes, peers }
      error.value = null
    } catch (e) {
      if (gen !== generation) return
      error.value = e instanceof Error ? e.message : String(e)
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
    const dev = deviceId.value
    const net = networkId.value
    if (!online.value || !net || !dev) {
      loading.value = false
      return
    }
    const gen = generation
    poller = usePolling(() => fetchOnce(gen, dev, net), INTERVAL_MS)
    poller.start()
  }

  watch(
    [deviceId, networkId, online],
    () => {
      raw.value = null
      error.value = null
      restart()
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  /** Fetch now; a fetch already in flight counts as the retry. */
  function retry() {
    if (loading.value) return
    error.value = null
    restart()
  }

  return { links, error, loading, retry }
}
