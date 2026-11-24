import { computed, markRaw, ref } from 'vue'
import { defineStore } from 'pinia'
import { nodePeers, nodeRoutes } from '../api/client'
import type { NodePeerInfo, NodeRouteInfo } from '../api/types'
import { buildPairs, classifyPeers, infraLabelFor, summarizePairs, type PeerLink } from '../domain/connections'
import { useInventory } from './inventory'
import { useSession } from './session'

/** How often the overview refreshes the fleet's routes and peers. */
export const FLEET_POLL_MS = 15_000
/**
 * Targets of one fleet pass in flight at once (each makes two proxy-rpc calls). Started one by one, so a
 * cancelled pass leaves at most this many targets' calls ahead of other pages' requests in the limiter.
 */
export const FLEET_CONCURRENCY = 4

/** Raw proxy-rpc answers of one device in one network (its central instance id == network id). */
export interface RuntimeEntry { routes: NodeRouteInfo[]; peers: NodePeerInfo[]; fetchedAt: number }

/**
 * Routes and peers per (device, network), shared by the overview (whole fleet) and device detail (one
 * device), so either page starts from what the other already fetched. Links are classified on read from
 * the inventory's current members, temporary peers and names. Requests go through the global proxy-rpc
 * limiter in the API client.
 */
export const useRuntime = defineStore('runtime', () => {
  const inventory = useInventory()
  const session = useSession()
  const entries = ref<Record<string, RuntimeEntry>>({})
  /** Message of the latest failed fetch per key; cleared by the next success. */
  const errors = ref<Record<string, string>>({})
  /** The first fleet refresh has finished (successfully or not). */
  const fleetLoaded = ref(false)

  /** Bumped by reset(); a fetch started under an older generation never writes its result. */
  let generation = 0
  const inflight = new Map<string, Promise<void>>()
  let fleetInflight: Promise<void> | null = null
  /** The current fleet pass; cancelFleet() flags it so it starts no further target. */
  let fleetPass: { cancelled: boolean } | null = null

  function runtimeKey(deviceId: string, networkId: string): string {
    return JSON.stringify([deviceId, networkId])
  }

  async function doFetch(gen: number, key: string, deviceId: string, networkId: string): Promise<void> {
    try {
      const [routes, peers] = await Promise.all([nodeRoutes(deviceId, networkId), nodePeers(deviceId, networkId)])
      if (gen !== generation) return
      // Replaced wholesale, never mutated: no need for deep reactivity over the payload.
      entries.value[key] = markRaw({ routes, peers, fetchedAt: Date.now() })
      delete errors.value[key]
    } catch (e) {
      if (gen !== generation) return
      errors.value[key] = e instanceof Error ? e.message : String(e)
    }
  }

  /** Single-flight per key; never rejects. A failure records the error and keeps the previous entry. */
  function fetch(deviceId: string, networkId: string): Promise<void> {
    const key = runtimeKey(deviceId, networkId)
    let p = inflight.get(key)
    if (!p) {
      const q: Promise<void> = doFetch(generation, key, deviceId, networkId).finally(() => {
        if (inflight.get(key) === q) inflight.delete(key)
      })
      inflight.set(key, q)
      p = q
    }
    return p
  }

  function clearError(deviceId: string, networkId: string): void {
    delete errors.value[runtimeKey(deviceId, networkId)]
  }

  const deviceNames = computed(() => {
    const names: Record<string, string> = {}
    for (const d of inventory.devices) names[d.id] = d.name
    return names
  })

  /** Classified links of the device in the network; null until something was fetched. */
  function linksFor(deviceId: string, networkId: string): PeerLink[] | null {
    const e = entries.value[runtimeKey(deviceId, networkId)]
    if (!e) return null
    return classifyPeers({
      routes: e.routes,
      peers: e.peers,
      members: inventory.membersByNetwork[networkId] ?? [],
      temporaryPeers: inventory.temporaryByNetwork[networkId] ?? [],
      deviceNames: deviceNames.value,
      infraLabel: infraLabelFor(inventory.networks.find((n) => n.network_id === networkId)?.networking_method),
    })
  }

  /** Online members with a machine id, per network. Webhook mode has no networks to ask about. */
  const fleetTargets = computed<{ deviceId: string; networkId: string }[]>(() => {
    if (session.webhookMode) return []
    const targets: { deviceId: string; networkId: string }[] = []
    for (const [networkId, members] of Object.entries(inventory.membersByNetwork)) {
      for (const m of members) {
        if (m.online !== true) continue
        const d = inventory.deviceById(m.device_id)
        if (!d || d.pending) continue
        targets.push({ deviceId: m.device_id, networkId })
      }
    }
    return targets
  })

  /**
   * Single-flight; never rejects. Waits for the inventory, which says who to ask. Fetches the targets at
   * most FLEET_CONCURRENCY at a time; fleetLoaded is set once a pass that was not cancelled has finished.
   */
  function refreshFleet(): Promise<void> {
    if (!inventory.loaded) return Promise.resolve()
    if (!fleetInflight) {
      const gen = generation
      const pass = { cancelled: false }
      const targets = [...fleetTargets.value]
      let next = 0
      const worker = async (): Promise<void> => {
        // Checked before each target: a cancelled pass starts nothing more.
        while (!pass.cancelled && next < targets.length) {
          const t = targets[next++]!
          await fetch(t.deviceId, t.networkId)
        }
      }
      const workers = Array.from({ length: Math.min(FLEET_CONCURRENCY, targets.length) }, worker)
      const p: Promise<void> = Promise.all(workers)
        .then(() => {
          if (!pass.cancelled && gen === generation) fleetLoaded.value = true
        })
        .finally(() => {
          if (fleetInflight === p) fleetInflight = null
          if (fleetPass === pass) fleetPass = null
        })
      fleetPass = pass
      fleetInflight = p
    }
    return fleetInflight
  }

  /**
   * Stop the current fleet pass (leaving the overview, logging out): no further target starts, the ones
   * in flight finish normally, fleetLoaded is left as it is. The next refreshFleet() starts a new pass.
   */
  function cancelFleet(): void {
    if (fleetPass) fleetPass.cancelled = true
    fleetPass = null
    fleetInflight = null
  }

  /** Network id → device id → links, for current targets whose latest fetch succeeded. */
  const fleetLinks = computed(() => {
    const byNetwork: Record<string, Record<string, PeerLink[]>> = {}
    for (const { deviceId, networkId } of fleetTargets.value) {
      if (runtimeKey(deviceId, networkId) in errors.value) continue
      const links = linksFor(deviceId, networkId)
      if (links) (byNetwork[networkId] ??= {})[deviceId] = links
    }
    return byNetwork
  })
  const pairs = computed(() => buildPairs(fleetLinks.value))
  const stats = computed(() => summarizePairs(pairs.value))

  /** Drop all data (logout / session expiry) and discard any fetch still in flight. */
  function reset(): void {
    generation++
    cancelFleet()
    inflight.clear()
    entries.value = {}
    errors.value = {}
    fleetLoaded.value = false
  }

  return {
    entries,
    errors,
    fleetLoaded,
    runtimeKey,
    fetch,
    clearError,
    linksFor,
    fleetTargets,
    refreshFleet,
    cancelFleet,
    fleetLinks,
    pairs,
    stats,
    reset,
  }
})
