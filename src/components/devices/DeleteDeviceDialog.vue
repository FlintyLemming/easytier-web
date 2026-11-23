<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'

const props = defineProps<{ device: DeviceView | null; busy?: boolean }>()
const emit = defineEmits<{ close: []; confirm: [block: boolean] }>()
const { t } = useI18n()

// Matches the original console: blocking is on by default.
const block = ref(true)
watch(() => props.device, () => { block.value = true })
</script>

<template>
  <UiDialog :open="!!device" :title="t('devices.deleteTitle')" @update:open="(v) => !v && emit('close')">
    <p>{{ t('devices.deleteBody', { name: device?.name ?? '' }) }}</p>
    <label class="mt-4 flex cursor-pointer items-start gap-2">
      <input v-model="block" type="checkbox" class="mt-0.5 h-4 w-4 accent-ink" />
      <span>
        <span class="text-ink">{{ t('devices.alsoBlock') }}</span>
        <span class="block text-[12px] text-muted">{{ t('devices.alsoBlockHint') }}</span>
      </span>
    </label>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
      <UiButton variant="danger" :loading="busy" @click="emit('confirm', block)">{{ t('devices.deleteConfirm') }}</UiButton>
    </template>
  </UiDialog>
</template>
