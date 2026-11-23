<script setup lang="ts">
import CopyButton from './CopyButton.vue'

export interface KeyValueItem {
  label: string
  value: string | null
  mono?: boolean
  copy?: boolean
}

withDefaults(defineProps<{ items: KeyValueItem[]; columns?: 1 | 2 }>(), { columns: 1 })
</script>

<template>
  <dl class="grid gap-x-8 gap-y-4" :class="columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'">
    <div v-for="item in items" :key="item.label" class="min-w-0">
      <dt class="caption-uppercase text-muted">{{ item.label }}</dt>
      <dd class="mt-1 flex items-center gap-1 text-[14px] text-ink" :class="item.mono ? 'font-mono' : ''">
        <span v-if="item.value !== null && item.value !== ''" class="min-w-0 break-all">{{ item.value }}</span>
        <span v-else class="text-muted-soft">—</span>
        <CopyButton v-if="item.copy && item.value" :text="item.value" :label="`Copy ${item.label}`" />
      </dd>
    </div>
  </dl>
</template>
