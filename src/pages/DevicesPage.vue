<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { addMembers, deleteMachine, setMachineAlias } from '../api/client'
import DeleteDeviceDialog from '../components/devices/DeleteDeviceDialog.vue'
import DeviceCard from '../components/devices/DeviceCard.vue'
import DeviceFilters from '../components/devices/DeviceFilters.vue'
import DeviceTable from '../components/devices/DeviceTable.vue'
import RenameDialog from '../components/devices/RenameDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiButton from '../components/ui/UiButton.vue'
import { useNarrow } from '../composables/useNarrow'
import { useToast } from '../composables/useToast'
import { filterDevices, sortDevices, statusCounts, type SortDir, type SortKey, type StatusFilter } from '../domain/deviceFilter'
import type { DeviceView } from '../domain/devices'
import { useInventory } from '../stores/inventory'

const { t } = useI18n()
const inventory = useInventory()
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
const sortKey = ref<SortKey | null>(null)
const sortDir = ref<SortDir>('asc')

const city = computed(() => {
  const c = route.query.city
  const v = Array.isArray(c) ? c[0] : c
  return v ? String(v) : null
})
function clearCity() {
  const { city: _drop, ...rest } = route.query
  void router.replace({ name: 'devices', query: rest })
}

const all = computed(() => inventory.devices)
const counts = computed(() => statusCounts(all.value))
const visible = computed(() =>
  sortDevices(filterDevices(all.value, { query: query.value, status: status.value, city: city.value }), sortKey.value ?? undefined, sortDir.value),
)
const primaryName = computed(() => inventory.primaryNetwork?.display_name ?? null)

function setSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = 'asc' }
}
function clearFilters() {
  query.value = ''
  status.value = 'all'
  if (city.value) clearCity()
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
        {{ t('devices.subtitle', { total: counts.all, online: counts.online, unjoined: counts.unjoined }) }}
      </p>
    </header>

    <SkeletonRows v-if="!inventory.loaded && !inventory.error" :rows="6" />

    <EmptyState v-else-if="!inventory.loaded" :title="t('devices.loadFailed')" :body="inventory.error ?? undefined">
      <template #action><UiButton @click="inventory.refresh()">{{ t('devices.retry') }}</UiButton></template>
    </EmptyState>

    <EmptyState v-else-if="all.length === 0" :title="t('devices.emptyTitle')" :body="t('devices.emptyBody')" />

    <template v-else>
      <DeviceFilters v-model:query="query" v-model:status="status" :counts="counts" :city="city" @clear-city="clearCity" />

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
        :sort-key="sortKey"
        :sort-dir="sortDir"
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
