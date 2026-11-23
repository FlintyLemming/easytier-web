<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import { useToast } from '../../composables/useToast'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'

const props = defineProps<{ device: DeviceView }>()
const emit = defineEmits<{ rename: []; delete: [] }>()
const { t } = useI18n()
const toast = useToast()

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('devices.copied'))
  } catch { /* clipboard unavailable */ }
}

const items = computed<UiMenuItem[]>(() => [
  { label: t('devices.rename'), onSelect: () => emit('rename') },
  { label: t('devices.copyIp'), disabled: !props.device.ip, onSelect: () => props.device.ip && copy(props.device.ip) },
  { label: t('devices.copyId'), onSelect: () => copy(props.device.id) },
  { label: '', separator: true },
  { label: t('devices.delete'), danger: true, onSelect: () => emit('delete') },
])
</script>

<template>
  <UiMenu :items="items">
    <template #trigger>
      <button
        type="button"
        :aria-label="t('devices.actions')"
        class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        @click.stop
        @keydown.enter.stop
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
    </template>
  </UiMenu>
</template>
