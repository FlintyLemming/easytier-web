<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { CentralNetworkSummary } from '../../api/types'
import type { DeviceView } from '../../domain/devices'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'

const props = defineProps<{ device: DeviceView; networkId: string | null; allNetworks: CentralNetworkSummary[] }>()
const emit = defineEmits<{ join: [] }>()
const { t } = useI18n()
const router = useRouter()

const currentName = computed(
  () =>
    props.device.networks.find((n) => n.id === props.networkId)?.name ??
    props.allNetworks.find((n) => n.network_id === props.networkId)?.display_name ??
    '—',
)
const canJoin = computed(() => props.allNetworks.some((n) => !props.device.networks.some((d) => d.id === n.network_id)))

function go(id: string) {
  if (id === props.device.defaultNetworkId) void router.push({ name: 'device', params: { machineId: props.device.id } })
  else void router.push({ name: 'device-network', params: { machineId: props.device.id, networkId: id } })
}

const items = computed<UiMenuItem[]>(() => [
  ...props.device.networks.map((n) => ({
    label: n.name,
    hint: n.id === props.device.defaultNetworkId ? t('detail.switcher.default') : undefined,
    onSelect: () => go(n.id),
  })),
  { label: '', separator: true },
  {
    label: t('detail.switcher.join'),
    disabled: !canJoin.value,
    hint: canJoin.value ? undefined : t('detail.switcher.allJoined'),
    onSelect: () => emit('join'),
  },
])
</script>

<template>
  <UiMenu :items="items">
    <template #trigger>
      <button
        type="button"
        :aria-label="t('detail.switcher.label', { network: currentName })"
        class="inline-flex h-8 max-w-[220px] cursor-pointer items-center gap-1.5 rounded-control border border-hairline-strong bg-surface-card px-3 text-[13px] text-ink hover:bg-canvas-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span class="truncate">{{ currentName }}</span>
        <span class="text-[10px] text-muted" aria-hidden="true">▾</span>
      </button>
    </template>
  </UiMenu>
</template>
