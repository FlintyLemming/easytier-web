<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 })
</script>

<template>
  <div class="flex flex-col gap-3" aria-busy="true">
    <div v-for="n in rows" :key="n" class="h-4 animate-pulse rounded-control bg-surface-strong" :class="n % 2 ? 'w-full' : 'w-2/3'" />
  </div>
</template>
