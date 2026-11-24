<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DevicePair } from '../../domain/connections'
import type { MapFocus } from '../../domain/geo/focus'
import type { LocationSummary } from '../../domain/geo/groups'
import type { MapView } from '../../domain/geo/projection'
import LocationRanking from './LocationRanking.vue'
import NodeMap from './NodeMap.vue'

const props = defineProps<{
  summary: LocationSummary
  focus: MapFocus
  pairs: DevicePair[]
  /** Webhook mode has no connections, so no 连接线 toggle. */
  central: boolean
  fleetLoaded: boolean
}>()
const { t } = useI18n()

const VIEWS: MapView[] = ['focus', 'world']
/** The user's pick; until then the focus view whenever there is a focus box. */
const chosen = ref<MapView | null>(null)
const view = computed<MapView>({
  get: () => (props.focus.box ? (chosen.value ?? 'focus') : 'world'),
  set: (v) => { chosen.value = v },
})

const linesOn = ref(true)
/** Lines join two places, so with fewer there is nothing to toggle. */
const linesToggle = computed(() => props.central && props.fleetLoaded && props.summary.groups.length >= 2)

const meta = computed(() => {
  const located = props.summary.groups.reduce((s, g) => s + g.total, 0)
  const base = t('overview.map.meta', { located, local: props.summary.local.total })
  const n = props.summary.unlocated.total
  return n > 0 ? base + t('overview.map.metaUnlocated', { n }) : base
})

const seg = (on: boolean) =>
  [
    'rounded-[6px] border px-2.5 py-[5px] text-[13px] font-medium leading-4 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
    on ? 'border-hairline-strong bg-surface-card text-ink' : 'border-transparent text-muted hover:text-ink',
  ]
</script>

<template>
  <section data-testid="map-section" class="rounded-card border border-hairline bg-surface-card">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
      <div class="min-w-0">
        <h2 class="text-[16px] font-medium leading-6 tracking-normal text-ink">{{ t('overview.map.title') }}</h2>
        <p class="mt-0.5 text-[13px] text-muted">{{ meta }}</p>
      </div>
      <div class="flex items-center gap-2">
        <div v-if="focus.box" class="inline-flex gap-0.5 rounded-control bg-hairline-soft p-0.5">
          <button v-for="v in VIEWS" :key="v" type="button" :aria-pressed="view === v" :class="seg(view === v)" @click="view = v">
            {{ t(`overview.map.${v}`) }}
          </button>
        </div>
        <div v-if="linesToggle" class="inline-flex rounded-control bg-hairline-soft p-0.5">
          <button type="button" :aria-pressed="linesOn" :class="seg(linesOn)" @click="linesOn = !linesOn">
            {{ t('overview.map.lines') }}
          </button>
        </div>
      </div>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div class="min-w-0 p-4 lg:border-r lg:border-hairline">
        <NodeMap v-model:view="view" :summary="summary" :focus="focus" :pairs="pairs" :lines="linesOn && linesToggle" />
      </div>
      <div class="min-w-0 border-t border-hairline px-5 py-4 lg:border-t-0">
        <LocationRanking :summary="summary" />
      </div>
    </div>

    <p v-if="summary.countryOnly" data-testid="map-precision-hint" class="border-t border-hairline px-5 py-3 text-[13px] text-muted">
      <i18n-t keypath="overview.map.countryOnly" tag="span">
        <template #flag><span class="font-mono">--geoip-db</span></template>
      </i18n-t>
    </p>
  </section>
</template>
