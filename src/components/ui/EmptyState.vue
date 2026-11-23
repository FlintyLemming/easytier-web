<script setup lang="ts">
defineProps<{ title: string; body?: string }>()
</script>

<template>
  <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
    <p class="text-[18px] text-ink">{{ title }}</p>
    <p v-if="body" class="max-w-sm text-[14px] text-muted">{{ body }}</p>
    <div v-if="$slots.action" class="mt-3"><slot name="action" /></div>
  </div>
</template>
