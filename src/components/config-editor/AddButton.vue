<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
</script>

<template>
  <UiButton size="sm" variant="text" class="self-start">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    <slot />
  </UiButton>
</template>
