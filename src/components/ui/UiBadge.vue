<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ tone?: 'neutral' | 'outline' | 'success' | 'danger' }>(), {
  tone: 'neutral',
})

const toneClass = computed(() => {
  switch (props.tone) {
    case 'outline':
      return 'bg-transparent border border-hairline-strong text-body'
    case 'success':
      return 'bg-canvas-soft text-success'
    case 'danger':
      return 'bg-canvas-soft text-error'
    default:
      return 'bg-surface-strong text-ink'
  }
})
</script>

<template>
  <span
    class="inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold leading-4"
    :class="toneClass"
  >
    <slot />
  </span>
</template>
