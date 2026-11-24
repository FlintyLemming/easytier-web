<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StatusFilter } from '../../domain/deviceFilter'

const props = withDefaults(
  defineProps<{ counts: Record<StatusFilter, number>; cities?: string[]; statuses?: StatusFilter[] }>(),
  { statuses: () => ['all', 'online', 'offline', 'unjoined'] },
)
const query = defineModel<string>('query', { default: '' })
const status = defineModel<StatusFilter>('status', { default: 'all' })
defineEmits<{ clearCity: [] }>()
const { t } = useI18n()
const chip = computed(() => {
  const c = props.cities
  if (!c?.length) return null
  return c.length === 1 ? t('devices.cityChip', { city: c[0] }) : t('devices.cityChipMany', { city: c[0], n: c.length })
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <input
      v-model="query"
      type="search"
      :placeholder="t('devices.search')"
      :aria-label="t('devices.search')"
      class="h-10 w-full rounded-control border border-hairline-strong bg-surface-card px-3 text-[14px] text-ink placeholder:text-muted-soft focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-72"
    />
    <div class="flex flex-wrap items-center gap-2" role="group" :aria-label="t('devices.filterLabel')">
      <button
        v-for="s in statuses"
        :key="s"
        type="button"
        :aria-pressed="status === s"
        class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill border px-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        :class="status === s ? 'border-ink bg-ink text-surface-card' : 'border-hairline-strong bg-surface-card text-ink hover:bg-surface-strong'"
        @click="status = s"
      >
        {{ t(`devices.filters.${s}`) }}
        <span class="font-mono text-[12px]" :class="status === s ? 'text-surface-card/80' : 'text-muted'">{{ counts[s] }}</span>
      </button>
      <button
        v-if="chip"
        type="button"
        :aria-label="`${chip}, ${t('devices.removeFilter')}`"
        class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill border border-hairline-strong bg-surface-strong px-3 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        @click="$emit('clearCity')"
      >
        {{ chip }}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </div>
</template>
