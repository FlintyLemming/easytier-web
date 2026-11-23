<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { relativeTime } from '../../domain/format'
import { useInventory } from '../../stores/inventory'

// Background refreshes keep the last good data on failure; this says so while it lasts.
const { t, locale } = useI18n()
const inventory = useInventory()
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 30_000)
onBeforeUnmount(() => clearInterval(tick))

const show = computed(() => inventory.loaded && !!inventory.error)
const time = computed(() => {
  const at = inventory.lastUpdatedAt
  if (at === null) return '—'
  return relativeTime(new Date(at).toISOString(), new Date(Math.max(now.value, at)), locale.value === 'en' ? 'en' : 'zh-CN')
})
</script>

<template>
  <div
    v-if="show"
    data-testid="refresh-notice"
    role="status"
    :title="inventory.error ?? undefined"
    class="border-b border-hairline bg-canvas-soft text-[13px] text-body"
  >
    <p class="mx-auto max-w-[1200px] px-6 py-2">{{ t('shell.refreshFailed', { time }) }}</p>
  </div>
</template>
