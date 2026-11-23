<script setup lang="ts">
import { t } from '../../i18n'
import CopyButton from './CopyButton.vue'

export interface KeyValueItem {
  label: string
  value: string | null
  /** Whole value in the mono font (IPs, versions, IDs). */
  mono?: boolean
  /** Render the value as ` · `-joined parts, each with its own font (e.g. a mono IP next to a city). */
  parts?: { text: string; mono?: boolean }[]
  copy?: boolean
}

withDefaults(defineProps<{ items: KeyValueItem[]; columns?: 1 | 2 }>(), { columns: 1 })
</script>

<template>
  <dl class="grid gap-x-8 gap-y-4" :class="columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'">
    <div v-for="item in items" :key="item.label" class="min-w-0">
      <dt class="caption-uppercase text-muted">{{ item.label }}</dt>
      <dd class="mt-1 flex items-center gap-1 text-[14px] text-ink" :class="item.mono ? 'font-mono' : ''">
        <span v-if="item.value !== null && item.value !== ''" class="min-w-0 break-all">
          <template v-if="item.parts">
            <template v-for="(part, i) in item.parts" :key="i"><span v-if="i > 0"> · </span><span :class="part.mono ? 'font-mono' : 'font-sans'">{{ part.text }}</span></template>
          </template>
          <template v-else>{{ item.value }}</template>
        </span>
        <span v-else class="text-muted-soft">—</span>
        <CopyButton v-if="item.copy && item.value" :text="item.value" :label="t('common.copyItem', { label: item.label })" />
      </dd>
    </div>
  </dl>
</template>
