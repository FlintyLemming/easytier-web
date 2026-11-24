<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useNarrow } from '../../composables/useNarrow'
import type { DevicePair } from '../../domain/connections'
import type { DeviceView } from '../../domain/devices'
import type { MapFocus } from '../../domain/geo/focus'
import type { LocationSummary } from '../../domain/geo/groups'
import { buildArcs, clusterPoints, edgeChips, type EdgeChip, type MapCluster, type ScreenPoint } from '../../domain/geo/layout'
import { landDotsPath, makeProjection, type MapView } from '../../domain/geo/projection'
import MapHoverCard from './MapHoverCard.vue'

const props = defineProps<{
  summary: LocationSummary
  focus: MapFocus
  pairs: DevicePair[]
  /** Draw the connection arcs: toggle on, central mode and pairs loaded. */
  lines: boolean
}>()
const view = defineModel<MapView>('view', { required: true })
const { t } = useI18n()
const router = useRouter()

// Size: the container's width (coalesced to one update per frame), a fixed height per breakpoint.
const root = ref<HTMLElement | null>(null)
const width = ref(0)
const narrow = useNarrow(640)
const height = computed(() => (narrow.value ? 260 : 380))
const size = computed(() => ({ width: width.value, height: height.value }))
let frame = 0
let observer: ResizeObserver | null = null
function measure() {
  frame = 0
  width.value = root.value?.clientWidth ?? 0
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(measure)
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})

const projection = computed(() => makeProjection(props.focus, view.value, size.value))
/** Nothing is laid out before the first measurement. */
const ready = computed(() => width.value > 0)
const land = computed(() => (ready.value ? landDotsPath(projection.value, size.value) : ''))

/** Groups on screen (4px slack) are clustered; the focus view turns the others into edge chips. */
const SLACK = 4
const split = computed(() => {
  const inside: ScreenPoint[] = []
  const outside: ScreenPoint[] = []
  if (!ready.value) return { inside, outside }
  const p = projection.value
  const { width: w, height: h } = size.value
  for (const g of props.summary.groups) {
    const xy = p([g.lon, g.lat])
    if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) continue
    const [x, y] = xy
    const pt: ScreenPoint = { key: g.key, label: g.label, x, y, total: g.total, online: g.online }
    if (x >= -SLACK && x <= w + SLACK && y >= -SLACK && y <= h + SLACK) inside.push(pt)
    else outside.push(pt)
  }
  return { inside, outside }
})
const clusters = computed(() => clusterPoints(split.value.inside))
const chips = computed(() => (view.value === 'focus' ? edgeChips(split.value.outside, size.value) : []))
const arcs = computed(() => (props.lines ? buildArcs(clusters.value, props.pairs, props.summary.groupOf) : []))

const nameOf = (labels: string[]) =>
  labels.length === 1 ? labels[0]! : t('overview.map.merged', { name: labels[0], n: labels.length })

function chipText(c: EdgeChip): string {
  const s = `${nameOf(c.labels)} ${c.total}`
  return { left: `← ${s}`, right: `${s} →`, top: `↑ ${s}`, bottom: `↓ ${s}` }[c.side]
}
function chipStyle(c: EdgeChip): Record<string, string> {
  if (c.side === 'left' || c.side === 'right') return { [c.side]: '6px', top: `${c.pos}px`, transform: 'translateY(-50%)' }
  // Shift by the same fraction of the chip's width as `pos` is of the map's, so it never leaves the map.
  return { [c.side]: '6px', left: `${c.pos}px`, transform: `translateX(-${(c.pos / width.value) * 100}%)` }
}

// Hover card: shown for the hovered or focused cluster, right of the dot, flipped left near the edge.
const CARD_W = 220
const CARD_GAP = 10
const cardId = useId()
const active = ref<string | null>(null)
/** Cluster with keyboard focus, which draws a focus ring. */
const ring = ref<string | null>(null)
const activeCluster = computed(() => clusters.value.find((c) => c.id === active.value) ?? null)
const groupByKey = computed(() => new Map(props.summary.groups.map((g) => [g.key, g])))
function devicesOf(c: MapCluster): DeviceView[] {
  // Each group is already online-first; the stable sort keeps that order across merged groups.
  return c.keys.flatMap((k) => groupByKey.value.get(k)?.devices ?? []).sort((a, b) => Number(b.online) - Number(a.online))
}
const card = ref<HTMLElement | null>(null)
const cardHeight = ref(0)
watch(activeCluster, async (c) => {
  if (!c) return
  await nextTick()
  cardHeight.value = card.value?.offsetHeight ?? 0
})
const cardStyle = computed(() => {
  const c = activeCluster.value
  if (!c) return undefined
  let left = c.x + c.r + CARD_GAP
  if (left + CARD_W > width.value) left = c.x - c.r - CARD_GAP - CARD_W
  // Title row level with the dot, but kept inside the map (the card is measured after it renders).
  const top = Math.min(c.y - 14, height.value - cardHeight.value)
  return { left: `${Math.max(0, left)}px`, top: `${Math.max(0, top)}px`, width: `${CARD_W}px` }
})

function onFocus(e: FocusEvent, c: MapCluster) {
  active.value = c.id
  ring.value = (e.currentTarget as Element).matches(':focus-visible') ? c.id : null
}
function onBlur() {
  active.value = null
  ring.value = null
}
function open(c: MapCluster) {
  void router.push({ name: 'devices', query: { city: c.labels } })
}
</script>

<template>
  <div data-testid="node-map">
    <div ref="root" class="relative" :style="{ height: `${height}px` }">
      <svg
        v-if="ready"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="t('overview.map.label')"
        class="block"
      >
        <path :d="land" fill="none" stroke="#cfcdc4" stroke-width="2.4" stroke-linecap="round" />
        <path
          v-for="a in arcs"
          :key="`${a.from}|${a.to}`"
          data-arc
          :data-relay="a.dashed ? '' : undefined"
          :d="a.d"
          fill="none"
          stroke="#26251e"
          stroke-opacity="0.38"
          stroke-width="1.2"
          :stroke-dasharray="a.dashed ? '4 4' : undefined"
        />
        <g
          v-for="c in clusters"
          :key="c.id"
          data-cluster
          role="button"
          tabindex="0"
          :aria-label="t('overview.map.clusterLabel', { name: nameOf(c.labels), total: c.total, online: c.online })"
          :aria-describedby="active === c.id ? cardId : undefined"
          :data-offline="c.online === 0 ? '' : undefined"
          class="cursor-pointer outline-none"
          @mouseenter="active = c.id"
          @mouseleave="active = null"
          @focus="onFocus($event, c)"
          @blur="onBlur"
          @keydown.esc="active = null"
          @keydown.enter.prevent="open(c)"
          @keydown.space.prevent="open(c)"
          @click="open(c)"
        >
          <circle v-if="ring === c.id" :cx="c.x" :cy="c.y" :r="c.r + 7" fill="none" stroke="#26251e" stroke-width="1.5" />
          <circle :cx="c.x" :cy="c.y" :r="c.r + 4" fill="#26251e" fill-opacity="0.08" />
          <circle
            :cx="c.x"
            :cy="c.y"
            :r="c.r"
            :fill="c.online > 0 ? '#26251e' : '#ffffff'"
            :stroke="c.online > 0 ? 'none' : '#26251e'"
            stroke-width="1.4"
          />
          <text
            v-if="c.total > 1"
            :x="c.x"
            :y="c.y"
            dy="0.35em"
            text-anchor="middle"
            font-size="11"
            font-weight="600"
            :fill="c.online > 0 ? '#f7f7f4' : '#26251e'"
          >{{ c.total }}</text>
          <text
            :x="c.x + c.r + 6"
            :y="c.y"
            dy="0.35em"
            font-size="12"
            fill="#26251e"
            stroke="#ffffff"
            stroke-width="3"
            stroke-linejoin="round"
            paint-order="stroke"
          >{{ nameOf(c.labels) }}</text>
        </g>
      </svg>

      <button
        v-for="c in chips"
        :key="`${c.side}:${c.keys.join()}`"
        type="button"
        class="absolute whitespace-nowrap rounded-pill border border-hairline-strong bg-surface-card px-2.5 py-1 text-[12px] leading-4 text-ink cursor-pointer hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        :style="chipStyle(c)"
        :aria-label="t('overview.map.chipLabel', { name: nameOf(c.labels), total: c.total })"
        @click="view = 'world'"
      >{{ chipText(c) }}</button>

      <div v-if="summary.groups.length === 0" class="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
        <div class="max-w-[400px] rounded-control bg-surface-card/90 px-4 py-3 text-center">
          <p class="text-[14px] text-ink">{{ t('overview.map.empty') }}</p>
          <p class="mt-1 text-[13px] text-muted">{{ t('overview.map.emptyBody') }}</p>
        </div>
      </div>

      <div v-if="activeCluster" :id="cardId" ref="card" role="tooltip" class="pointer-events-none absolute z-10" :style="cardStyle">
        <MapHoverCard
          :title="nameOf(activeCluster.labels)"
          :online="activeCluster.online"
          :total="activeCluster.total"
          :devices="devicesOf(activeCluster)"
        />
      </div>
    </div>

    <!-- Under the map's bottom-left corner, in a row kept even while hidden, so it covers no dot and never shifts the layout. -->
    <div class="mt-2 h-4">
      <div v-if="lines" data-testid="map-legend" class="flex items-center gap-4 text-[12px] leading-4 text-muted">
        <span class="inline-flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="#26251e" stroke-opacity="0.5" stroke-width="1.2" /></svg>
          {{ t('overview.map.legendDirect') }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="#26251e" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="4 4" /></svg>
          {{ t('overview.map.legendRelay') }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.8" fill="#ffffff" stroke="#26251e" stroke-width="1.4" /></svg>
          {{ t('overview.map.legendOffline') }}
        </span>
      </div>
    </div>
  </div>
</template>
