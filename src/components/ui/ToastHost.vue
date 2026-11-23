<script setup lang="ts">
import { dismissToast, toasts } from '../../composables/useToast'
import { t } from '../../i18n'
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2">
    <div
      v-for="item in toasts"
      :key="item.id"
      :role="item.kind === 'error' ? 'alert' : 'status'"
      class="pointer-events-auto flex items-start justify-between gap-3 rounded-card border border-hairline bg-surface-card px-4 py-3 text-[14px]"
      :class="item.kind === 'error' ? 'text-error' : 'text-ink'"
    >
      <span>{{ item.message }}</span>
      <button type="button" class="cursor-pointer text-muted hover:text-ink" :aria-label="t('common.dismiss')" @click="dismissToast(item.id)">×</button>
    </div>
  </div>
</template>
