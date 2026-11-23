<script setup lang="ts">
defineProps<{ title: string; meta?: string }>()
</script>

<template>
  <section class="rounded-card border border-hairline bg-surface-card">
    <header class="flex items-center justify-between gap-3 border-b border-hairline-soft px-5 py-3">
      <div class="flex items-baseline gap-2">
        <h2 class="caption-uppercase text-muted">{{ title }}</h2>
        <span v-if="meta" class="text-[12px] text-muted-soft">{{ meta }}</span>
      </div>
      <slot name="action" />
    </header>
    <div class="p-5"><slot /></div>
  </section>
</template>
