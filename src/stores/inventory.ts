import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { listBlockedDevices, listMachines, listMembers, listNetworks } from '../api/client'
import type { BlockedDevice, CentralNetworkMember, CentralNetworkSummary, RawMachine, TemporaryPeer } from '../api/types'
import { buildDeviceViews, primaryNetworkId } from '../domain/devices'
import { useSession } from './session'

export const useInventory = defineStore('inventory', () => {
  const session = useSession()
  const machines = ref<RawMachine[]>([])
  const networks = ref<CentralNetworkSummary[]>([])
  const membersByNetwork = ref<Record<string, CentralNetworkMember[]>>({})
  /** `temporary_peers` from the same `GET /networks/{id}/members` responses, keyed by network id. */
  const temporaryByNetwork = ref<Record<string, TemporaryPeer[]>>({})
  const blocked = ref<BlockedDevice[]>([])
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const devices = computed(() => buildDeviceViews(machines.value, networks.value, membersByNetwork.value))
  const primaryNetwork = computed<CentralNetworkSummary | null>(() => {
    const id = primaryNetworkId(networks.value)
    return networks.value.find((n) => n.network_id === id) ?? null
  })
  const byId = computed(() => new Map(devices.value.map((d) => [d.id, d])))
  function deviceById(id: string) {
    return byId.value.get(id)
  }

  let inflight: Promise<void> | null = null
  /** Bumped by reset(); a refresh started under an older generation never writes its result. */
  let generation = 0

  async function doRefresh(gen: number): Promise<void> {
    try {
      // Webhook mode (spec §6.9): upstream registers no `/networks*` routes (they 404), so only the
      // endpoints NetworkApi always registers are read; networks, members and temporary peers stay empty.
      const webhook = session.webhookMode
      const [m, n, b] = await Promise.all([
        listMachines(),
        webhook ? Promise.resolve([] as CentralNetworkSummary[]) : listNetworks(),
        listBlockedDevices(),
      ])
      const memberLists = await Promise.all(n.map((net) => listMembers(net.network_id)))
      if (gen !== generation) return
      const byNet: Record<string, CentralNetworkMember[]> = {}
      const tempByNet: Record<string, TemporaryPeer[]> = {}
      n.forEach((net, i) => {
        byNet[net.network_id] = memberLists[i]!.members
        tempByNet[net.network_id] = memberLists[i]!.temporary_peers
      })
      machines.value = m
      networks.value = n
      membersByNetwork.value = byNet
      temporaryByNetwork.value = tempByNet
      blocked.value = b
      loaded.value = true
      error.value = null
    } catch (e) {
      if (gen !== generation) return
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** Single-flight; never rejects so pollers keep going. */
  function refresh(): Promise<void> {
    if (!inflight) {
      const p: Promise<void> = doRefresh(generation).finally(() => { if (inflight === p) inflight = null })
      inflight = p
    }
    return inflight
  }

  /** Drop all data (logout / session expiry) and discard any refresh still in flight. */
  function reset(): void {
    generation++
    inflight = null
    machines.value = []
    networks.value = []
    membersByNetwork.value = {}
    temporaryByNetwork.value = {}
    blocked.value = []
    loaded.value = false
    error.value = null
  }

  return {
    machines,
    networks,
    membersByNetwork,
    temporaryByNetwork,
    blocked,
    loaded,
    error,
    devices,
    primaryNetwork,
    deviceById,
    refresh,
    reset,
  }
})
