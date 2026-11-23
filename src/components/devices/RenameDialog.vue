<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'

const props = defineProps<{ device: DeviceView | null; busy?: boolean }>()
const emit = defineEmits<{ close: []; save: [alias: string] }>()
const { t } = useI18n()

const MAX = 64
const alias = ref('')
watch(() => props.device, (d) => { alias.value = d?.alias ?? '' }, { immediate: true })

const tooLong = computed(() => [...alias.value.trim()].length > MAX)
function submit() {
  if (tooLong.value) return
  emit('save', alias.value.trim())
}
</script>

<template>
  <UiDialog :open="!!device" :title="t('devices.renameTitle')" @update:open="(v) => !v && emit('close')">
    <form class="flex flex-col gap-2" @submit.prevent="submit">
      <UiInput v-model="alias" :label="t('devices.aliasLabel')" :placeholder="device?.hostname" :error="tooLong ? t('devices.aliasTooLong') : undefined" />
      <p class="text-[12px] text-muted">{{ t('devices.aliasHint') }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <UiButton variant="secondary" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
        <UiButton type="submit" variant="secondary" :loading="busy" :disabled="tooLong">{{ t('common.save') }}</UiButton>
      </div>
    </form>
  </UiDialog>
</template>
