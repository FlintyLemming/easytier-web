<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { SORT_KEYS, type DeviceSort, type SortKey } from '../../domain/deviceFilter'

/** The card list's stand-in for the table's sortable headers. */
const sort = defineModel<DeviceSort | null>({ required: true })
const { t } = useI18n()
const id = useId()

function onKey(e: Event) {
  const v = (e.target as HTMLSelectElement).value as SortKey | ''
  sort.value = v ? { key: v, dir: 'asc' } : null
}
function flip() {
  if (sort.value) sort.value = { key: sort.value.key, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <label :for="id" class="text-[13px] text-muted">{{ t('devices.sort.label') }}</label>
    <select
      :id="id"
      :value="sort?.key ?? ''"
      class="h-8 cursor-pointer rounded-pill border border-hairline-strong bg-surface-card px-3 text-[13px] text-ink focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      @change="onKey"
    >
      <option value="">{{ t('devices.sort.default') }}</option>
      <option v-for="k in SORT_KEYS" :key="k" :value="k">{{ t(`devices.sort.keys.${k}`) }}</option>
    </select>
    <button
      v-if="sort"
      type="button"
      :aria-label="t(`devices.sort.${sort.dir}`)"
      :title="t(`devices.sort.${sort.dir}`)"
      class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-pill border border-hairline-strong bg-surface-card text-ink hover:bg-surface-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      @click="flip"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-if="sort.dir === 'asc'" d="M12 19V5M6 11l6-6 6 6" />
        <path v-else d="M12 5v14M6 13l6 6 6-6" />
      </svg>
    </button>
  </div>
</template>
