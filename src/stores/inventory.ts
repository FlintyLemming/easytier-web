import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { listBlockedDevices, listMachines, listMembers, listNetworks } from '../api/client'
import type { BlockedDevice, CentralNetworkMember, CentralNetworkSummary, RawMachine } from '../api/types'
import { buildDeviceViews, primaryNetworkId } from '../domain/devices'

export const useInventory = defineStore('inventory', () => {
  const machines = ref<RawMachine[]>([])
  const networks = ref<CentralNetworkSummary[]>([])
  const membersByNetwork = ref<Record<string, CentralNetworkMember[]>>({})
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

  async function doRefresh(): Promise<void> {
    try {
      const [m, n, b] = await Promise.all([listMachines(), listNetworks(), listBlockedDevices()])
      const memberLists = await Promise.all(n.map((net) => listMembers(net.network_id)))
      const byNet: Record<string, CentralNetworkMember[]> = {}
      n.forEach((net, i) => { byNet[net.network_id] = memberLists[i]!.members })
      machines.value = m
      networks.value = n
      membersByNetwork.value = byNet
      blocked.value = b
      loaded.value = true
      error.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** Single-flight; never rejects so pollers keep going. */
  function refresh(): Promise<void> {
    if (!inflight) {
      inflight = doRefresh().finally(() => { inflight = null })
    }
    return inflight
  }

  return { machines, networks, membersByNetwork, blocked, loaded, error, devices, primaryNetwork, deviceById, refresh }
})
