<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import InstancesPanel from '../components/instances/InstancesPanel.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiButton from '../components/ui/UiButton.vue'
import { useInventory } from '../stores/inventory'

// A device's manual instances (spec §5.3, §6.7), reached from the network switcher or the
// not-in-network state. The AppShell owns the inventory poller; this page only reads the store.
const { t } = useI18n()
const route = useRoute()
const inventory = useInventory()

onMounted(() => { if (!inventory.loaded) void inventory.refresh() })

const machineId = computed(() => (typeof route.params.machineId === 'string' ? route.params.machineId : ''))
const device = computed(() => inventory.deviceById(machineId.value) ?? null)
/** Instances whose id is a central network's id belong to that network, not to this page. */
const centralIds = computed(() => [
  ...inventory.networks.map((n) => n.network_id),
  ...(device.value?.networks.map((n) => n.id) ?? []),
])
</script>

<template>
  <div class="flex flex-col gap-6">
    <SkeletonRows v-if="!inventory.loaded && !inventory.error" :rows="6" />

    <EmptyState v-else-if="!inventory.loaded" :title="t('detail.loadFailed')" :body="inventory.error ?? undefined">
      <template #action><UiButton @click="inventory.refresh()">{{ t('detail.retry') }}</UiButton></template>
    </EmptyState>

    <!-- A device without a machine id yet has no instances to manage. -->
    <EmptyState v-else-if="!device || device.pending" :title="t('detail.notFound')" :body="t('detail.notFoundBody')">
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
      <header class="flex flex-col gap-3">
        <nav :aria-label="t('detail.breadcrumb')" class="flex min-w-0 items-center text-[13px] text-muted">
          <RouterLink to="/devices" class="shrink-0 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{{ t('nav.devices') }}</RouterLink>
          <span class="mx-1.5 shrink-0" aria-hidden="true">/</span>
          <RouterLink
            :to="{ name: 'device', params: { machineId: device.id } }"
            class="min-w-0 truncate hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >{{ device.name }}</RouterLink>
          <span class="mx-1.5 shrink-0" aria-hidden="true">/</span>
          <span class="shrink-0 text-ink" aria-current="page">{{ t('instances.breadcrumb') }}</span>
        </nav>
        <div>
          <h1 class="text-[26px] font-normal tracking-[-0.325px] text-ink">{{ t('instances.title') }}</h1>
          <p class="mt-1 text-[14px] text-muted">{{ t('instances.subtitle') }}</p>
        </div>
      </header>

      <InstancesPanel :key="device.id" :device="device" :central-ids="centralIds" />
    </template>
  </div>
</template>
