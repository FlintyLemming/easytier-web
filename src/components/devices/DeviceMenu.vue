<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import { useToast } from '../../composables/useToast'
import { copyText } from '../../lib/clipboard'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'

// `central: false` (webhook mode): alias and delete act on the central device registry, which webhook
// mode never fills (upstream answers 404), so only copying the ID remains.
const props = withDefaults(defineProps<{ device: DeviceView; central?: boolean }>(), { central: true })
const emit = defineEmits<{ rename: []; delete: [] }>()
const { t } = useI18n()
const toast = useToast()

async function copy(text: string) {
  if (await copyText(text)) toast.success(t('devices.copied'))
  else toast.error(t('common.copyFailed'))
}

const items = computed<UiMenuItem[]>(() => {
  // A pending device (no heartbeat yet) has no machine id, so there is nothing to act on.
  if (props.device.pending) return []
  const copyId: UiMenuItem = { label: t('devices.copyId'), onSelect: () => copy(props.device.id) }
  if (!props.central) return [copyId]
  return [
    { label: t('devices.rename'), onSelect: () => emit('rename') },
    { label: t('devices.copyIp'), disabled: !props.device.ip, onSelect: () => props.device.ip && copy(props.device.ip) },
    copyId,
    { label: '', separator: true },
    { label: t('devices.delete'), danger: true, onSelect: () => emit('delete') },
  ]
})
</script>

<template>
  <UiMenu v-if="items.length" :items="items">
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
