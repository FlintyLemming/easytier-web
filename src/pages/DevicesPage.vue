<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { addMembers, deleteMachine, setMachineAlias } from '../api/client'
import DeleteDeviceDialog from '../components/devices/DeleteDeviceDialog.vue'
import DeviceCard from '../components/devices/DeviceCard.vue'
import DeviceFilters from '../components/devices/DeviceFilters.vue'
import DeviceSortControl from '../components/devices/DeviceSortControl.vue'
import DeviceTable from '../components/devices/DeviceTable.vue'
import RenameDialog from '../components/devices/RenameDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiButton from '../components/ui/UiButton.vue'
import { useNarrow } from '../composables/useNarrow'
import { useToast } from '../composables/useToast'
import { filterDevices, nextSort, sortDevices, statusCounts, type DeviceSort, type SortKey, type StatusFilter } from '../domain/deviceFilter'
import type { DeviceView } from '../domain/devices'
import { loadDeviceSort, saveDeviceSort } from '../lib/deviceSort'
import { useInventory } from '../stores/inventory'
import { useSession } from '../stores/session'

const { t } = useI18n()
const inventory = useInventory()
const session = useSession()
/** Webhook mode (spec §6.9) has no central networks: no joining, no 未加入网络 state. */
const central = computed(() => !session.webhookMode)
const statuses = computed<StatusFilter[]>(() => (central.value ? ['all', 'online', 'offline', 'unjoined'] : ['all', 'online', 'offline']))
const toast = useToast()
const route = useRoute()
const router = useRouter()
const narrow = useNarrow(640)

// The AppShell owns the inventory poller; this page only re-renders from the store.
const now = ref(new Date())
const tick = setInterval(() => { now.value = new Date() }, 30_000)
onBeforeUnmount(() => clearInterval(tick))
onMounted(() => { if (!inventory.loaded) void inventory.refresh() })

const query = ref('')
const status = ref<StatusFilter>('all')
/** Remembered across visits; `null` is the default order (online first, then name). */
const sort = ref<DeviceSort | null>(loadDeviceSort())
watch(sort, saveDeviceSort)

const cities = computed(() => {
  const c = route.query.city
  return (Array.isArray(c) ? c : [c]).filter((v): v is string => !!v)
})
function clearCity() {
  const { city: _drop, ...rest } = route.query
  void router.replace({ name: 'devices', query: rest })
}

const all = computed(() => inventory.devices)
const counts = computed(() => statusCounts(all.value))
const visible = computed(() =>
  sortDevices(filterDevices(all.value, { query: query.value, status: status.value, city: cities.value }), sort.value?.key, sort.value?.dir),
)
const primaryName = computed(() => inventory.primaryNetwork?.display_name ?? null)

function setSort(k: SortKey) {
  sort.value = nextSort(sort.value, k)
}
function clearFilters() {
  query.value = ''
  status.value = 'all'
  if (cities.value.length) clearCity()
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** A refresh already in flight may carry pre-mutation data, so refresh twice. */
async function refreshFresh() {
  await inventory.refresh()
  await inventory.refresh()
}

const joiningIds = reactive(new Set<string>())
async function join(d: DeviceView) {
  const net = inventory.primaryNetwork
  if (!net || joiningIds.has(d.id)) return
  joiningIds.add(d.id)
  try {
    await addMembers(net.network_id, [d.id])
    toast.success(t('devices.joined', { name: d.name, network: net.display_name }))
    await refreshFresh()
  } catch (e) {
    toast.error(t('devices.joinFailed', { message: msg(e) }))
  } finally {
    joiningIds.delete(d.id)
  }
}

const renameTarget = ref<DeviceView | null>(null)
const deleteTarget = ref<DeviceView | null>(null)
const busy = ref(false)

async function saveAlias(alias: string) {
  const d = renameTarget.value
  if (!d) return
  busy.value = true
  try {
    await setMachineAlias(d.id, alias)
    toast.success(t('devices.renamed'))
    renameTarget.value = null
    await refreshFresh()
  } catch (e) {
    toast.error(t('devices.renameFailed', { message: msg(e) }))
  } finally {
    busy.value = false
  }
}

async function confirmDelete(block: boolean) {
  const d = deleteTarget.value
  if (!d) return
  busy.value = true
  try {
    await deleteMachine(d.id, block)
    toast.success(t('devices.deleted', { name: d.name }))
    deleteTarget.value = null
    await refreshFresh()
  } catch (e) {
    toast.error(t('devices.deleteFailed', { message: msg(e) }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header>
      <h1 class="text-[26px] font-normal tracking-[-0.325px] text-ink">{{ t('devices.title') }}</h1>
      <p v-if="inventory.loaded" class="mt-1 text-[14px] text-muted">
        {{
          central
            ? t('devices.subtitle', { total: counts.all, online: counts.online, unjoined: counts.unjoined })
            : t('devices.subtitleWebhook', { total: counts.all, online: counts.online })
        }}
      </p>
    </header>

    <SkeletonRows v-if="!inventory.loaded && !inventory.error" :rows="6" />

    <EmptyState v-else-if="!inventory.loaded" :title="t('devices.loadFailed')" :body="inventory.error ?? undefined">
      <template #action><UiButton @click="inventory.refresh()">{{ t('devices.retry') }}</UiButton></template>
    </EmptyState>

    <EmptyState v-else-if="all.length === 0" :title="t('devices.emptyTitle')" :body="t('devices.emptyBody')" />

    <template v-else>
      <div class="flex flex-col gap-3">
        <DeviceFilters v-model:query="query" v-model:status="status" :counts="counts" :cities="cities" :statuses="statuses" @clear-city="clearCity" />
        <!-- The table sorts from its headers; the card list has none, so it gets this instead. -->
        <DeviceSortControl v-if="narrow" v-model="sort" />
      </div>

      <EmptyState v-if="visible.length === 0" :title="t('devices.noMatch')" :body="t('devices.noMatchBody')">
        <template #action><UiButton @click="clearFilters">{{ t('devices.clearFilters') }}</UiButton></template>
      </EmptyState>

      <ul v-else-if="narrow" class="flex flex-col gap-3">
        <DeviceCard
          v-for="d in visible"
          :key="d.id"
          :device="d"
          :now="now"
          :primary-name="primaryName"
          :joining="joiningIds.has(d.id)"
          :central="central"
          @join="join(d)"
          @rename="renameTarget = d"
          @delete="deleteTarget = d"
        />
      </ul>
      <DeviceTable
        v-else
        :devices="visible"
        :now="now"
        :primary-name="primaryName"
        :joining-ids="joiningIds"
        :sort-key="sort?.key ?? null"
        :sort-dir="sort?.dir ?? 'asc'"
        :central="central"
        @sort="setSort"
        @join="join"
        @rename="(d) => (renameTarget = d)"
        @delete="(d) => (deleteTarget = d)"
      />
    </template>

    <RenameDialog :device="renameTarget" :busy="busy" @close="renameTarget = null" @save="saveAlias" />
    <DeleteDeviceDialog :device="deleteTarget" :busy="busy" @close="deleteTarget = null" @confirm="confirmDelete" />
  </div>
</template>
