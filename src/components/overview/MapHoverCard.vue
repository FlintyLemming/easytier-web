<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import StatusDot from '../ui/StatusDot.vue'

const props = defineProps<{ title: string; online: number; total: number; devices: DeviceView[] }>()
const { t } = useI18n()

const LIMIT = 6
const shown = computed(() => props.devices.slice(0, LIMIT))
const rest = computed(() => props.devices.length - shown.value.length)
</script>

<template>
  <div data-testid="map-hover-card" class="rounded-control border border-hairline-strong bg-surface-card px-3 py-2.5">
    <div class="mb-1.5 flex items-baseline justify-between gap-3">
      <span class="truncate text-[13px] font-semibold text-ink" :title="title">{{ title }}</span>
      <span class="shrink-0 text-[12px] text-muted">{{ t('overview.map.cardOnline', { online, total }) }}</span>
    </div>
    <ul>
      <li
        v-for="d in shown"
        :key="d.id"
        data-testid="hover-device"
        class="flex items-center gap-1.5 py-[3px] text-[12px]"
        :class="d.online ? 'text-ink' : 'text-muted-soft'"
      >
        <StatusDot :online="d.online" />
        <span class="min-w-0 flex-1 truncate">{{ d.name }}</span>
        <span class="shrink-0 font-mono" :class="d.online ? 'text-body' : 'text-muted-soft'">{{ d.ip ?? '—' }}</span>
      </li>
    </ul>
    <p v-if="rest > 0" class="pt-1 text-[12px] text-muted">{{ t('overview.map.more', { n: rest }) }}</p>
  </div>
</template>
