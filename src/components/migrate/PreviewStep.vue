<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { readyToRun, selectedPreviews, type ChangeKey, type DevicePreview } from '../../domain/migration/classify'
import UiButton from '../ui/UiButton.vue'
import ChangeSummary from './ChangeSummary.vue'
import DevicePreviewCard from './DevicePreviewCard.vue'

const props = defineProps<{ previews: DevicePreview[]; unfinished?: string[] }>()
const choices = defineModel<Record<string, boolean>>('choices', { required: true })
const confirmed = defineModel<Record<string, ChangeKey[]>>('confirmed', { required: true })
/** Devices on an auto-selected address instead of their legacy fixed IP. */
const autoIp = defineModel<string[]>('autoIp', { required: true })
const emit = defineEmits<{ back: []; next: [] }>()
const { t } = useI18n()

const selected = computed(() => selectedPreviews(props.previews, choices.value))
const ready = computed(() => readyToRun(props.previews, choices.value, confirmed.value))

function setChoice(id: string, v: boolean) {
  choices.value = { ...choices.value, [id]: v }
}
function setAuto(id: string, on: boolean) {
  autoIp.value = on ? [...new Set([...autoIp.value, id])] : autoIp.value.filter((x) => x !== id)
}
function setConfirmed(id: string, keys: ChangeKey[]) {
  confirmed.value = { ...confirmed.value, [id]: keys }
}
function confirmKind(key: ChangeKey) {
  const next = { ...confirmed.value }
  for (const p of selected.value) {
    if (p.plan.changes.some((c) => c.key === key)) next[p.device.id] = [...new Set([...(next[p.device.id] ?? []), key])]
  }
  confirmed.value = next
}
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="wizard-step-preview">
    <ChangeSummary :previews="previews" :selected="selected" :confirmed="confirmed" @confirm-kind="confirmKind" />
    <DevicePreviewCard
      v-for="p in previews"
      :key="p.device.id"
      :preview="p"
      :choice="choices[p.device.id] === true"
      :confirmed="confirmed[p.device.id] ?? []"
      :unfinished="unfinished?.includes(p.device.id) ?? false"
      @update:choice="setChoice(p.device.id, $event)"
      @update:confirmed="setConfirmed(p.device.id, $event)"
      @update:auto="setAuto(p.device.id, $event)"
    />
    <div class="flex justify-between gap-3">
      <UiButton @click="emit('back')">{{ t('migrate.back') }}</UiButton>
      <UiButton variant="primary" :disabled="!ready" @click="emit('next')">{{ t('migrate.next') }}</UiButton>
    </div>
  </div>
</template>
