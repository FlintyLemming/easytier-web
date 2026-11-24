<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import StatCards from '../components/overview/StatCards.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiButton from '../components/ui/UiButton.vue'
import { usePolling } from '../composables/usePolling'
import { overviewStats } from '../domain/overview'
import { useInventory } from '../stores/inventory'
import { FLEET_POLL_MS, useRuntime } from '../stores/runtime'
import { useSession } from '../stores/session'

const { t } = useI18n()
const inventory = useInventory()
const runtime = useRuntime()
const session = useSession()
const central = computed(() => !session.webhookMode)

// The AppShell owns the inventory poller; this page only polls peers and routes (central mode).
const fleetPoller = usePolling(() => runtime.refreshFleet(), FLEET_POLL_MS)
onMounted(() => {
  if (central.value) fleetPoller.start()
})
watch(
  () => inventory.loaded,
  (loaded) => {
    if (loaded && central.value) void runtime.refreshFleet()
  },
)

const stats = computed(() => overviewStats(inventory.devices, inventory.networks, inventory.primaryNetwork))
</script>

<template>
  <div class="flex flex-col gap-6">
    <header>
      <h1 class="text-[36px] font-normal leading-tight tracking-[-0.72px] text-ink">{{ t('overview.title') }}</h1>
      <p class="mt-1 text-[14px] text-muted">{{ t('overview.autoRefresh') }}</p>
    </header>

    <SkeletonRows v-if="!inventory.loaded && !inventory.error" :rows="4" />

    <EmptyState v-else-if="!inventory.loaded" :title="t('overview.loadFailed')" :body="inventory.error ?? undefined">
      <template #action><UiButton @click="inventory.refresh()">{{ t('devices.retry') }}</UiButton></template>
    </EmptyState>

    <StatCards v-else :stats="stats" :central="central" :fleet-loaded="runtime.fleetLoaded" :direct="runtime.stats" />
  </div>
</template>
