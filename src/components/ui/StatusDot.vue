<script setup lang="ts">
defineProps<{ online: boolean }>()
</script>

<template>
  <span
    class="inline-block h-[7px] w-[7px] shrink-0 rounded-pill"
    :class="online ? 'bg-success' : 'bg-muted-soft'"
    role="img"
    :aria-label="online ? 'online' : 'offline'"
  />
</template>
