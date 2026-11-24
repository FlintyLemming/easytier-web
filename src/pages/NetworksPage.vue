<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getGatewayInfo } from '../api/client'
import type { CentralNetworkSummary, GatewayInfo } from '../api/types'
import CreateNetworkDialog from '../components/networks/CreateNetworkDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import { useNarrow } from '../composables/useNarrow'
import { useInventory } from '../stores/inventory'
import { useSession } from '../stores/session'

const { t } = useI18n()
const inventory = useInventory()
const session = useSession()
const route = useRoute()
const router = useRouter()
const narrow = useNarrow(640)

const networks = computed(() => [...inventory.networks].sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-CN')))

// Webhook mode has no central networks (spec §6.9); with exactly one network the list is skipped
// unless asked for with ?list=1 (the detail page's breadcrumb), so a second one can still be created.
watchEffect(() => {
  if (session.webhookMode) {
    void router.replace('/')
    return
  }
  if (inventory.loaded && networks.value.length === 1 && route.query.list !== '1') {
    void router.replace({ name: 'network', params: { networkId: networks.value[0]!.network_id } })
  }
})

const gateway = ref<GatewayInfo | null>(null)
const creating = ref(false)
onMounted(async () => {
  if (session.webhookMode) return
  if (!inventory.loaded) void inventory.refresh()
  gateway.value = await getGatewayInfo()
})

function open(n: CentralNetworkSummary) {
  void router.push({ name: 'network', params: { networkId: n.network_id } })
}
function onRowClick(e: MouseEvent, n: CentralNetworkSummary) {
  if ((e.target as HTMLElement).closest('button, a, input, label')) return
  open(n)
}
function onEnter(e: KeyboardEvent, n: CentralNetworkSummary) {
  if (e.target === e.currentTarget) open(n)
}
const members = (n: CentralNetworkSummary) => `${n.online_member_count} / ${n.member_count}`
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-[26px] font-normal tracking-[-0.325px] text-ink">{{ t('networks.title') }}</h1>
        <p v-if="inventory.loaded && networks.length > 0" class="mt-1 text-[14px] text-muted">
          {{ t('networks.count', { n: networks.length }, networks.length) }}
        </p>
      </div>
      <UiButton v-if="inventory.loaded && networks.length > 0" variant="primary" @click="creating = true">{{ t('networks.new') }}</UiButton>
    </header>

    <SkeletonRows v-if="!inventory.loaded && !inventory.error" :rows="4" />

    <EmptyState v-else-if="!inventory.loaded" :title="t('devices.loadFailed')" :body="inventory.error ?? undefined">
      <template #action><UiButton @click="inventory.refresh()">{{ t('devices.retry') }}</UiButton></template>
    </EmptyState>

    <EmptyState v-else-if="networks.length === 0" :title="t('networks.empty')" :body="t('networks.emptyBody')">
      <template #action><UiButton variant="primary" @click="creating = true">{{ t('networks.new') }}</UiButton></template>
    </EmptyState>

    <ul v-else-if="narrow" class="flex flex-col gap-3">
      <li
        v-for="n in networks"
        :key="n.network_id"
        data-testid="network-card"
        tabindex="0"
        class="cursor-pointer rounded-card border border-hairline bg-surface-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        @click="onRowClick($event, n)"
        @keydown.enter="onEnter($event, n)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-[14px] font-medium text-ink">{{ n.display_name }}</div>
            <div class="truncate font-mono text-[12px] text-muted">{{ n.network_name }}</div>
          </div>
          <UiBadge v-if="n.secure_mode" tone="outline">{{ t('networks.secureBadge') }}</UiBadge>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span>{{ t(`networks.method.${n.networking_method}`) }}</span>
          <span class="font-mono">{{ n.virtual_cidr || '—' }}</span>
          <span class="font-mono">{{ members(n) }}</span>
        </div>
      </li>
    </ul>

    <div v-else class="overflow-hidden rounded-card border border-hairline bg-surface-card">
      <table class="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col style="width: 34%" />
          <col style="width: 22%" />
          <col style="width: 20%" />
          <col style="width: 12%" />
          <col style="width: 12%" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('networks.cols.name') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('networks.cols.method') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('networks.cols.cidr') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('networks.cols.members') }}</th>
            <th scope="col"><span class="sr-only">{{ t('networks.secureBadge') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="n in networks"
            :key="n.network_id"
            data-testid="network-row"
            tabindex="0"
            class="cursor-pointer border-t border-hairline-soft hover:bg-canvas-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
            @click="onRowClick($event, n)"
            @keydown.enter="onEnter($event, n)"
          >
            <td class="min-w-0 px-4 py-3 align-middle">
              <div class="truncate text-[14px] font-medium text-ink" :title="n.display_name">{{ n.display_name }}</div>
              <div class="truncate font-mono text-[12px] text-muted">{{ n.network_name }}</div>
            </td>
            <td class="px-4 py-3 align-middle text-[14px] text-ink">{{ t(`networks.method.${n.networking_method}`) }}</td>
            <td class="px-4 py-3 align-middle font-mono text-[13px] text-ink">{{ n.virtual_cidr || '—' }}</td>
            <td class="px-4 py-3 align-middle font-mono text-[13px] text-ink">{{ members(n) }}</td>
            <td class="px-4 py-3 text-right align-middle">
              <UiBadge v-if="n.secure_mode" tone="outline">{{ t('networks.secureBadge') }}</UiBadge>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <CreateNetworkDialog v-model:open="creating" :gateway="gateway" />
  </div>
</template>
