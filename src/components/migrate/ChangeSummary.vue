<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { deviceCounts, type ChangeKey, type DevicePreview } from '../../domain/migration/classify'
import UiButton from '../ui/UiButton.vue'
import { changeLabel } from './changeText'

const props = defineProps<{
  previews: DevicePreview[]
  selected: DevicePreview[]
  confirmed: Record<string, ChangeKey[]>
}>()
const emit = defineEmits<{ confirmKind: [key: ChangeKey] }>()
const { t } = useI18n()

/** Change kinds among the devices that will migrate, with how many devices have each. */
const kinds = computed(() => {
  const out = new Map<ChangeKey, { n: number; open: number }>()
  for (const p of props.selected) {
    for (const c of p.plan.changes) {
      const e = out.get(c.key) ?? { n: 0, open: 0 }
      e.n++
      if (!(props.confirmed[p.device.id] ?? []).includes(c.key)) e.open++
      out.set(c.key, e)
    }
  }
  return [...out.entries()].map(([key, e]) => ({ key, ...e }))
})
</script>

<template>
  <section data-testid="change-summary" class="rounded-card border border-hairline bg-surface-card px-5 py-4">
    <p class="text-[14px] text-ink">
      {{ t('migrate.preview.summary', { n: deviceCounts(previews, selected).migrate, m: deviceCounts(previews, selected).skip }) }}
    </p>
    <ul v-if="kinds.length" class="mt-3 flex flex-col gap-2">
      <li v-for="k in kinds" :key="k.key" class="flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <span class="text-body">{{ t('migrate.preview.kindCount', { label: changeLabel(t, k.key), n: k.n }) }}</span>
        <UiButton size="sm" :data-testid="`confirm-kind-${k.key}`" :disabled="k.open === 0" @click="emit('confirmKind', k.key)">
          {{ t('migrate.preview.confirmAll') }}
        </UiButton>
      </li>
    </ul>
  </section>
</template>
