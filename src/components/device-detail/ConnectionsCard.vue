<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNarrow } from '../../composables/useNarrow'
import type { PeerLink } from '../../domain/connections'
import { formatBytes } from '../../domain/format'
import SectionCard from '../ui/SectionCard.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{ links: PeerLink[] | null; error: string | null; loading: boolean; online: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const narrow = useNarrow(640)

const meta = computed(() => {
  if (!props.online || !props.links) return undefined
  const direct = props.links.filter((l) => l.mode.type === 'p2p').length
  return t('detail.connections.meta', { direct, relay: props.links.length - direct })
})

function modeLabel(l: PeerLink): string {
  if (l.mode.type === 'p2p') return t('detail.connections.p2p', { tunnel: l.mode.tunnel.toUpperCase() })
  // Spec §6.4: relays through infrastructure read 「中继 · 经 网关/服务器」, not the node's hostname.
  if (l.mode.viaKind === 'infra') {
    return t('detail.connections.relay', { via: t(`detail.connections.infra.${l.mode.viaInfra ?? 'server'}`) })
  }
  return t('detail.connections.relay', { via: l.mode.via })
}

function latency(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 10) return `${Math.round(ms * 10) / 10} ms`
  return `${Math.round(ms)} ms`
}

function traffic(l: PeerLink): string {
  if (l.mode.type !== 'p2p' || (l.rxBytes === null && l.txBytes === null)) return '—'
  return `↓ ${formatBytes(l.rxBytes ?? 0)}  ↑ ${formatBytes(l.txBytes ?? 0)}`
}

const badge = (l: PeerLink) =>
  l.kind === 'temporary'
    ? t('detail.connections.temporary')
    : l.kind === 'infra'
      ? t(`detail.connections.infra.${l.infra ?? 'server'}`)
      : null
</script>

<template>
  <SectionCard data-testid="connections-card" :title="t('detail.connections.title')" :meta="meta">
    <p v-if="!online" class="text-[14px] text-muted">{{ t('detail.connections.offline') }}</p>
    <template v-else>
      <div v-if="error" class="mb-4 flex flex-wrap items-center justify-between gap-3 last:mb-0" role="alert">
        <p class="min-w-0 text-[14px] text-error">{{ t('detail.connections.error', { message: error }) }}</p>
        <UiButton size="sm" :loading="loading" @click="emit('retry')">{{ t('detail.connections.retry') }}</UiButton>
      </div>
      <template v-if="links === null">
        <SkeletonRows v-if="!error" :rows="3" />
      </template>
      <p v-else-if="links.length === 0" class="text-[14px] text-muted">{{ t('detail.connections.empty') }}</p>
      <ul v-else-if="narrow" class="flex flex-col">
        <li v-for="l in links" :key="l.peerId" class="flex flex-col gap-1 border-t border-hairline-soft py-3 first:border-t-0 first:pt-0">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-[14px] text-ink">{{ l.name }}</span>
            <UiBadge v-if="badge(l)" tone="outline">{{ badge(l) }}</UiBadge>
            <span class="ml-auto shrink-0 font-mono text-[12px] text-body">{{ latency(l.latencyMs) }}</span>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span class="font-mono text-[12px] text-body">{{ l.ip ?? '—' }}</span>
            <span
              data-testid="link-mode"
              class="inline-block rounded-pill px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-body"
              :class="l.mode.type === 'p2p' ? 'bg-hairline-soft' : 'border border-hairline-strong bg-surface-card'"
            >{{ modeLabel(l) }}</span>
            <span class="font-mono text-[12px] whitespace-pre text-muted">{{ traffic(l) }}</span>
          </div>
        </li>
      </ul>
      <div v-else class="-mx-5 -mb-5 overflow-x-auto">
        <table :aria-label="t('detail.connections.title')" class="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" class="caption-uppercase py-2 pr-3 pl-5 font-semibold text-muted">{{ t('detail.connections.cols.device') }}</th>
              <th scope="col" class="caption-uppercase px-3 py-2 font-semibold text-muted">{{ t('detail.connections.cols.ip') }}</th>
              <th scope="col" class="caption-uppercase px-3 py-2 font-semibold text-muted">{{ t('detail.connections.cols.mode') }}</th>
              <th scope="col" class="caption-uppercase px-3 py-2 text-right font-semibold text-muted">{{ t('detail.connections.cols.latency') }}</th>
              <th scope="col" class="caption-uppercase py-2 pr-5 pl-3 text-right font-semibold text-muted">{{ t('detail.connections.cols.traffic') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in links" :key="l.peerId" class="border-t border-hairline-soft">
              <td class="py-2.5 pr-3 pl-5 align-middle">
                <div class="flex max-w-[240px] min-w-0 items-center gap-2">
                  <span class="truncate text-[13px] text-ink" :title="l.name">{{ l.name }}</span>
                  <UiBadge v-if="badge(l)" tone="outline">{{ badge(l) }}</UiBadge>
                </div>
              </td>
              <td class="px-3 py-2.5 align-middle font-mono text-[12px] whitespace-nowrap text-body">{{ l.ip ?? '—' }}</td>
              <td class="px-3 py-2.5 align-middle">
                <span
                  data-testid="link-mode"
                  class="inline-block rounded-pill px-2 py-0.5 text-[11px] font-semibold tracking-[0.3px] whitespace-nowrap text-body"
                  :class="l.mode.type === 'p2p' ? 'bg-hairline-soft' : 'border border-hairline-strong bg-surface-card'"
                >{{ modeLabel(l) }}</span>
              </td>
              <td class="px-3 py-2.5 text-right align-middle font-mono text-[12px] whitespace-nowrap text-body">{{ latency(l.latencyMs) }}</td>
              <td class="py-2.5 pr-5 pl-3 text-right align-middle font-mono text-[12px] whitespace-pre text-muted">{{ traffic(l) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </SectionCard>
</template>
