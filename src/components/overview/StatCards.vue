<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OverviewStats } from '../../domain/overview'

const props = defineProps<{
  stats: OverviewStats
  /** Webhook mode has no networks or connections: only the online and updatable cells. */
  central: boolean
  fleetLoaded: boolean
  direct: { direct: number; relayed: number; rate: number | null }
}>()
const { t } = useI18n()

const rateText = computed(() => {
  if (!props.fleetLoaded || props.direct.rate === null) return '—'
  return `${Math.round(props.direct.rate * 100)}%`
})
const rateSub = computed(() => {
  if (!props.fleetLoaded) return t('overview.stats.directLoading')
  if (props.direct.rate === null) return t('overview.stats.directNone')
  return t('overview.stats.directSub', { total: props.direct.direct + props.direct.relayed, relayed: props.direct.relayed })
})
</script>

<template>
  <section
    data-testid="stat-cards"
    class="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline"
    :class="central ? 'sm:grid-cols-4' : ''"
  >
    <div data-testid="stat-online" class="bg-surface-card p-5">
      <p class="caption-uppercase text-muted">{{ t('overview.stats.online') }}</p>
      <p class="mt-2 text-[30px] font-normal leading-tight tracking-[-0.4px] text-ink">
        <span class="font-mono">{{ stats.online }}</span><span class="font-mono text-muted"> / {{ stats.total }}</span>
      </p>
      <p class="mt-1 text-[13px] text-muted">
        {{ stats.offline === 0 ? t('overview.stats.allOnline') : t('overview.stats.offline', { n: stats.offline }) }}
      </p>
    </div>

    <div v-if="central" data-testid="stat-networks" class="bg-surface-card p-5">
      <p class="caption-uppercase text-muted">{{ t('overview.stats.networks') }}</p>
      <p class="mt-2 font-mono text-[30px] font-normal leading-tight tracking-[-0.4px] text-ink">{{ stats.networks }}</p>
      <p class="mt-1 text-[13px] text-muted">
        <template v-if="stats.primary">
          {{ stats.primary.name }}<template v-if="stats.primary.cidr"> · <span class="font-mono">{{ stats.primary.cidr }}</span></template>
        </template>
        <template v-else>{{ t('overview.stats.noNetworks') }}</template>
      </p>
    </div>

    <div v-if="central" data-testid="stat-direct" class="bg-surface-card p-5">
      <p class="caption-uppercase text-muted">{{ t('overview.stats.direct') }}</p>
      <p class="mt-2 font-mono text-[30px] font-normal leading-tight tracking-[-0.4px] text-ink">{{ rateText }}</p>
      <p class="mt-1 text-[13px] text-muted">{{ rateSub }}</p>
    </div>

    <div data-testid="stat-outdated" class="bg-surface-card p-5">
      <p class="caption-uppercase text-muted">{{ t('overview.stats.outdated') }}</p>
      <p class="mt-2 font-mono text-[30px] font-normal leading-tight tracking-[-0.4px] text-ink">{{ stats.outdated }}</p>
      <p class="mt-1 text-[13px] text-muted">
        <i18n-t v-if="stats.latest" keypath="overview.stats.latest" tag="span">
          <template #version><span class="font-mono">{{ stats.latest }}</span></template>
        </i18n-t>
        <template v-else>—</template>
      </p>
    </div>
  </section>
</template>
