<script setup lang="ts">
import { dismissToast, toasts } from '../../composables/useToast'
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
    <div
      v-for="t in toasts"
      :key="t.id"
      role="status"
      class="pointer-events-auto flex items-start justify-between gap-3 rounded-card border border-hairline bg-surface-card px-4 py-3 text-[14px]"
      :class="t.kind === 'error' ? 'text-error' : 'text-ink'"
    >
      <span>{{ t.message }}</span>
      <button type="button" class="cursor-pointer text-muted hover:text-ink" aria-label="Dismiss" @click="dismissToast(t.id)">×</button>
    </div>
  </div>
</template>
