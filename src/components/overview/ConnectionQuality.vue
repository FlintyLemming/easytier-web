<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLinkFormat } from '../../composables/useLinkFormat'
import { useInventory } from '../../stores/inventory'
import { useRuntime } from '../../stores/runtime'
import EmptyState from '../ui/EmptyState.vue'
import SectionCard from '../ui/SectionCard.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'

const { t } = useI18n()
const inventory = useInventory()
const runtime = useRuntime()
const { modeLabel, latencyText } = useLinkFormat()

const slowest = computed(() =>
  [...runtime.pairs]
    .sort((x, y) => (y.latencyMs ?? -1) - (x.latencyMs ?? -1))
    .slice(0, 5),
)
const meta = computed(() => {
  const direct = runtime.pairs.filter((p) => p.direct).length
  return t('overview.quality.meta', { relayed: runtime.pairs.length - direct, direct })
})
const nameOf = (id: string) => inventory.deviceById(id)?.name ?? id
</script>

<template>
  <SectionCard data-testid="connection-quality" :title="t('overview.quality.title')" :meta="runtime.fleetReady ? meta : undefined">
    <SkeletonRows v-if="!runtime.fleetReady" :rows="5" />
    <EmptyState v-else-if="runtime.pairs.length === 0" :title="t('overview.quality.empty')" />
    <ul v-else class="-my-3 flex flex-col">
      <li
        v-for="p in slowest"
        :key="`${p.networkId}:${p.a}:${p.b}`"
        data-testid="quality-row"
        class="flex items-center gap-3 border-t border-hairline-soft py-3 text-[14px] first:border-t-0"
      >
        <span class="flex min-w-0 flex-1 items-center gap-1.5 text-ink">
          <RouterLink :to="`/devices/${p.a}/networks/${p.networkId}`" class="max-w-[45%] truncate hover:underline" :title="nameOf(p.a)">{{ nameOf(p.a) }}</RouterLink>
          <span class="shrink-0 text-muted" aria-hidden="true">↔</span>
          <span class="min-w-0 truncate" :title="nameOf(p.b)">{{ nameOf(p.b) }}</span>
        </span>
        <span class="shrink-0 text-[13px] text-muted">{{ modeLabel(p.mode) }}</span>
        <span class="w-16 shrink-0 text-right font-mono text-[13px] text-body">{{ latencyText(p.latencyMs) }}</span>
      </li>
    </ul>
  </SectionCard>
</template>
