<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LocationSummary } from '../../domain/geo/groups'

const props = defineProps<{ summary: LocationSummary }>()
const { t } = useI18n()

const LIMIT = 8
const groups = computed(() => props.summary.groups)
const top = computed(() => groups.value.slice(0, LIMIT))
const max = computed(() => Math.max(1, ...groups.value.map((g) => g.total)))
const others = computed(() => {
  const rest = groups.value.slice(LIMIT)
  if (rest.length === 0) return null
  return {
    n: rest.length,
    online: rest.reduce((s, g) => s + g.online, 0),
    total: rest.reduce((s, g) => s + g.total, 0),
  }
})
const cityLink = (city: string) => ({ name: 'devices', query: { city } })
/** The backend's location text for LAN devices (not translated: the device filter matches it verbatim). */
const LOCAL_NETWORK = '本地网络'

const row = 'grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-2.5 py-[7px] text-[13px]'
</script>

<template>
  <div data-testid="location-ranking">
    <p class="caption-uppercase mb-1 text-muted">{{ t('overview.ranking.title') }}</p>
    <ul class="flex flex-col">
      <li v-for="g in top" :key="g.key" data-testid="ranking-row" class="border-b border-hairline-soft last:border-b-0">
        <RouterLink :to="cityLink(g.label)" :class="row" class="group">
          <span class="truncate text-ink group-hover:underline" :title="g.label">{{ g.label }}</span>
          <span class="h-1 overflow-hidden rounded-pill bg-hairline-soft" aria-hidden="true">
            <span class="block h-full rounded-pill bg-ink/70" :style="{ width: `${(g.total / max) * 100}%` }" />
          </span>
          <span class="text-right font-mono text-body">{{ g.online }}/{{ g.total }}</span>
        </RouterLink>
      </li>
      <li v-if="others" data-testid="ranking-row" class="border-b border-hairline-soft last:border-b-0" :class="row">
        <span class="col-span-2 truncate text-muted">{{ t('overview.ranking.others', { n: others.n }) }}</span>
        <span class="text-right font-mono text-muted">{{ others.online }}/{{ others.total }}</span>
      </li>
      <li v-if="summary.local.total > 0" data-testid="ranking-row" class="border-b border-hairline-soft last:border-b-0">
        <RouterLink :to="cityLink(LOCAL_NETWORK)" :class="row" class="group">
          <span class="truncate text-muted group-hover:underline">{{ t('overview.ranking.local') }}</span>
          <span class="truncate text-[12px] text-muted-soft">{{ t('overview.ranking.localSub') }}</span>
          <span class="text-right font-mono text-muted">{{ summary.local.online }}/{{ summary.local.total }}</span>
        </RouterLink>
      </li>
      <li v-if="summary.unlocated.total > 0" data-testid="ranking-row" class="border-b border-hairline-soft last:border-b-0" :class="row">
        <span class="col-span-2 truncate text-muted">{{ t('overview.ranking.unlocated') }}</span>
        <span class="text-right font-mono text-muted">{{ summary.unlocated.online }}/{{ summary.unlocated.total }}</span>
      </li>
    </ul>
  </div>
</template>
