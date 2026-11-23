<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { DeviceView } from '../../domain/devices'
import { locationText } from '../../domain/format'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'
import DeviceMenu from './DeviceMenu.vue'
import DeviceStatus from './DeviceStatus.vue'

const props = withDefaults(
  defineProps<{ device: DeviceView; now: Date; primaryName: string | null; joining?: boolean; central?: boolean }>(),
  { central: true },
)
const emit = defineEmits<{ join: []; rename: []; delete: [] }>()
const { t } = useI18n()
const router = useRouter()

function open() {
  void router.push({ name: 'device', params: { machineId: props.device.id } })
}
function onClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, label')) return
  open()
}
function onEnter(e: KeyboardEvent) {
  if (e.target === e.currentTarget) open()
}
</script>

<template>
  <li
    data-testid="device-card"
    tabindex="0"
    class="cursor-pointer rounded-card border border-hairline bg-surface-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    @click="onClick"
    @keydown.enter="onEnter"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div data-testid="device-name" :title="device.name" class="truncate text-[14px] font-medium text-ink">{{ device.name }}</div>
        <div class="truncate text-[12px] text-muted">
          {{ device.os || '—' }}<template v-if="device.alias"> · <span class="font-mono">{{ device.hostname }}</span></template>
        </div>
      </div>
      <DeviceMenu :device="device" :central="central" @rename="emit('rename')" @delete="emit('delete')" />
    </div>
    <div class="mt-3 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <template v-if="device.defaultNetworkId !== null">
          <div class="truncate font-mono text-[13px] text-ink">{{ device.ip ?? '—' }}</div>
          <div class="truncate text-[12px] text-muted">
            {{ device.networks.find((n) => n.id === device.defaultNetworkId)?.name }}<template v-if="device.networks.length > 1"> · {{ t('devices.moreNetworks', { n: device.networks.length - 1 }) }}</template>
          </div>
        </template>
        <div v-else-if="central && !device.pending" class="flex flex-col items-start gap-1">
          <span class="text-[12px] text-muted">{{ t('devices.notJoined') }}</span>
          <UiButton size="sm" :loading="joining" :disabled="!primaryName" :title="primaryName ? undefined : t('devices.noPrimary')" @click.stop="emit('join')">
            {{ t('devices.join', { network: primaryName ?? '' }) }}
          </UiButton>
        </div>
        <div v-else data-testid="ip-none" class="font-mono text-[13px] text-muted-soft">—</div>
      </div>
      <DeviceStatus :device="device" :now="now" class="shrink-0" />
    </div>
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      <span class="truncate">{{ locationText(device.location) ?? '—' }}</span>
      <span class="font-mono">{{ device.version || '—' }}</span>
      <UiBadge v-if="device.outdated" tone="outline">{{ t('devices.outdated') }}</UiBadge>
    </div>
  </li>
</template>
