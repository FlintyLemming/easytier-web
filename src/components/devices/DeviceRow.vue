<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { DeviceView } from '../../domain/devices'
import { locationText } from '../../domain/format'
import CopyButton from '../ui/CopyButton.vue'
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
  <tr
    tabindex="0"
    class="group cursor-pointer border-t border-hairline-soft hover:bg-canvas-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
    @click="onClick"
    @keydown.enter="onEnter"
  >
    <td class="min-w-0 px-4 py-3 align-middle">
      <div data-testid="device-name" :title="device.name" class="truncate text-[14px] font-medium text-ink">{{ device.name }}</div>
      <div class="truncate text-[12px] text-muted">
        {{ device.os || '—' }}<template v-if="device.alias"> · <span class="font-mono">{{ device.hostname }}</span></template>
      </div>
    </td>
    <td class="min-w-0 px-4 py-3 align-middle">
      <template v-if="device.defaultNetworkId !== null">
        <div class="flex items-center gap-1">
          <span class="truncate font-mono text-[13px] text-ink">{{ device.ip ?? '—' }}</span>
          <span v-if="device.ip" class="opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100">
            <CopyButton :text="device.ip" :label="t('devices.copyIp')" />
          </span>
        </div>
        <div class="truncate text-[12px] text-muted">
          {{ device.networks.find((n) => n.id === device.defaultNetworkId)?.name }}<template v-if="device.networks.length > 1"> · {{ t('devices.moreNetworks', { n: device.networks.length - 1 }) }}</template>
        </div>
      </template>
      <div v-else-if="central && !device.pending" class="flex flex-col items-start gap-1">
        <span class="text-[12px] text-muted">{{ t('devices.notJoined') }}</span>
        <UiButton
          size="sm"
          :loading="joining"
          :disabled="!primaryName"
          :title="primaryName ? undefined : t('devices.noPrimary')"
          @click.stop="emit('join')"
        >
          {{ t('devices.join', { network: primaryName ?? '' }) }}
        </UiButton>
      </div>
      <!-- Webhook mode (no central networks) or no machine id yet: nothing to join. -->
      <span v-else data-testid="ip-none" class="font-mono text-[13px] text-muted-soft">—</span>
    </td>
    <td class="min-w-0 px-4 py-3 align-middle">
      <div
        data-testid="location-text"
        class="truncate text-[14px]"
        :class="device.locationCached ? 'text-muted-soft' : 'text-ink'"
        :title="device.locationCached ? t('devices.cachedLocation') : undefined"
      >{{ locationText(device.knownLocation) ?? '—' }}</div>
      <div class="truncate font-mono text-[12px] text-muted">{{ device.publicIp ?? '—' }}</div>
    </td>
    <td class="px-4 py-3 align-middle">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="truncate font-mono text-[13px] text-ink">{{ device.version || '—' }}</span>
        <UiBadge v-if="device.outdated" tone="outline">{{ t('devices.outdated') }}</UiBadge>
      </div>
    </td>
    <td class="px-4 py-3 align-middle"><DeviceStatus :device="device" :now="now" /></td>
    <td class="px-2 py-3 text-right align-middle">
      <DeviceMenu :device="device" :central="central" @rename="emit('rename')" @delete="emit('delete')" />
    </td>
  </tr>
</template>
