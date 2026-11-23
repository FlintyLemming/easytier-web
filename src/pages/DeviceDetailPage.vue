<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { addMembers, deleteMachine } from '../api/client'
import ConnectionsCard from '../components/device-detail/ConnectionsCard.vue'
import DangerZone from '../components/device-detail/DangerZone.vue'
import DetailHeader from '../components/device-detail/DetailHeader.vue'
import DiagnosticsCard from '../components/device-detail/DiagnosticsCard.vue'
import JoinNetworkDialog from '../components/device-detail/JoinNetworkDialog.vue'
import MemberSettingsCard from '../components/device-detail/MemberSettingsCard.vue'
import NotInNetworkState from '../components/device-detail/NotInNetworkState.vue'
import OverviewCard from '../components/device-detail/OverviewCard.vue'
import { errorMessage, refreshInventoryFresh } from '../components/device-detail/writes'
import DeleteDeviceDialog from '../components/devices/DeleteDeviceDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiButton from '../components/ui/UiButton.vue'
import { useDeviceRuntime } from '../composables/useDeviceRuntime'
import { useToast } from '../composables/useToast'
import { memberIp, type DeviceView } from '../domain/devices'
import { useInventory } from '../stores/inventory'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const inventory = useInventory()
const toast = useToast()

// The AppShell owns the 5 s inventory poller; this page only reads the store.
onMounted(() => { if (!inventory.loaded) void inventory.refresh() })
const now = ref(new Date())
const tick = setInterval(() => { now.value = new Date() }, 30_000)
onBeforeUnmount(() => clearInterval(tick))

const param = (v: unknown) => (typeof v === 'string' && v ? v : null)
const machineId = computed(() => param(route.params.machineId) ?? '')
const device = computed(() => inventory.deviceById(machineId.value) ?? null)
/** `/devices/:id` shows the device's default network; `/devices/:id/networks/:networkId` a chosen one. */
const networkId = computed(() => param(route.params.networkId) ?? device.value?.defaultNetworkId ?? null)
const inNetwork = computed(() => !!networkId.value && !!device.value?.networks.some((n) => n.id === networkId.value))
const network = computed(() => inventory.networks.find((n) => n.network_id === networkId.value) ?? null)
const networkName = computed(
  () => network.value?.display_name ?? device.value?.networks.find((n) => n.id === networkId.value)?.name ?? '',
)
const member = computed(() => {
  if (!inNetwork.value || !networkId.value) return null
  return (inventory.membersByNetwork[networkId.value] ?? []).find((m) => m.device_id === machineId.value) ?? null
})
const ip = computed(() => (member.value ? memberIp(member.value) : null))
const online = computed(() => device.value?.online ?? false)
/** Remount per-network editors when switching networks so no draft leaks across. */
const networkKey = computed(() => `${machineId.value}:${networkId.value ?? ''}`)

const runtime = useDeviceRuntime(
  machineId,
  computed(() => (inNetwork.value ? networkId.value : null)),
  online,
)

// --- joining networks (switcher dialog and the not-in-network state) ---
const joinOpen = ref(false)
const joining = ref(false)

async function joinNetwork(targetId: string) {
  const d = device.value
  if (!d || joining.value) return
  const net = inventory.networks.find((n) => n.network_id === targetId)
  joining.value = true
  try {
    await addMembers(targetId, [d.id])
    toast.success(t('detail.join.joined', { name: d.name, network: net?.display_name ?? targetId }))
    joinOpen.value = false
    await refreshInventoryFresh()
    const def = inventory.deviceById(d.id)?.defaultNetworkId
    await router.push(
      def === targetId
        ? { name: 'device', params: { machineId: d.id } }
        : { name: 'device-network', params: { machineId: d.id, networkId: targetId } },
    )
  } catch (e) {
    toast.error(t('detail.join.failed', { message: errorMessage(e) }))
  } finally {
    joining.value = false
  }
}

function joinPrimary() {
  const p = inventory.primaryNetwork
  if (p) void joinNetwork(p.network_id)
}

// --- delete device ---
const deleteTarget = ref<DeviceView | null>(null)
const deleting = ref(false)

async function confirmDelete(block: boolean) {
  const d = deleteTarget.value
  if (!d) return
  deleting.value = true
  try {
    await deleteMachine(d.id, block)
    toast.success(t('devices.deleted', { name: d.name }))
    deleteTarget.value = null
    await router.push({ name: 'devices' })
    void refreshInventoryFresh()
  } catch (e) {
    toast.error(t('devices.deleteFailed', { message: errorMessage(e) }))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <SkeletonRows v-if="!inventory.loaded && !inventory.error" :rows="6" />

    <EmptyState v-else-if="!inventory.loaded" :title="t('detail.loadFailed')" :body="inventory.error ?? undefined">
      <template #action><UiButton @click="inventory.refresh()">{{ t('detail.retry') }}</UiButton></template>
    </EmptyState>

    <EmptyState v-else-if="!device" :title="t('detail.notFound')" :body="t('detail.notFoundBody')">
      <template #action>
        <RouterLink
          to="/devices"
          class="inline-flex h-10 items-center rounded-control border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {{ t('detail.backToList') }}
        </RouterLink>
      </template>
    </EmptyState>

    <template v-else>
      <DetailHeader
        :device="device"
        :network-id="networkId"
        :ip="ip"
        :all-networks="inventory.networks"
        :now="now"
        @join="joinOpen = true"
        @delete="deleteTarget = device"
      />

      <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div class="flex min-w-0 flex-col gap-4">
          <NotInNetworkState
            v-if="device.networks.length === 0"
            :primary-name="inventory.primaryNetwork?.display_name ?? null"
            :busy="joining"
            @join="joinPrimary"
            @choose="joinOpen = true"
          />

          <section v-else-if="!inNetwork" class="rounded-card border border-hairline bg-surface-card">
            <EmptyState :title="t('detail.notInThisNetwork.title')" :body="t('detail.notInThisNetwork.body')">
              <template #action>
                <RouterLink
                  :to="{ name: 'device', params: { machineId: device.id } }"
                  class="inline-flex h-10 items-center rounded-control border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {{ t('detail.notInThisNetwork.back') }}
                </RouterLink>
              </template>
            </EmptyState>
          </section>

          <template v-else-if="networkId">
            <ConnectionsCard
              :links="runtime.links.value"
              :error="runtime.error.value"
              :loading="runtime.loading.value"
              :online="online"
              @retry="runtime.retry()"
            />
            <MemberSettingsCard
              :key="`settings:${networkKey}`"
              :device-id="device.id"
              :network-id="networkId"
              :network-name="networkName"
              :virtual-cidr="network?.virtual_cidr ?? null"
              :online="online"
              :member="member"
            />
            <DiagnosticsCard :key="`diagnostics:${networkKey}`" :device-id="device.id" :network-id="networkId" :online="online" />
            <DangerZone :device="device" :network-id="networkId" :network-name="networkName" @delete="deleteTarget = device" />
          </template>
        </div>

        <!-- Below 1024px the page is one column with the overview first (the connections table needs the width). -->
        <aside class="order-first min-w-0 lg:order-none">
          <OverviewCard
            :device="device"
            :ip="ip"
            :network-name="inNetwork ? networkName : null"
            :network-cidr="inNetwork ? (network?.virtual_cidr ?? null) : null"
            :now="now"
          />
        </aside>
      </div>

      <JoinNetworkDialog v-model:open="joinOpen" :device="device" :networks="inventory.networks" :busy="joining" @join="joinNetwork" />
    </template>

    <DeleteDeviceDialog :device="deleteTarget" :busy="deleting" @close="deleteTarget = null" @confirm="confirmDelete" />
  </div>
</template>
