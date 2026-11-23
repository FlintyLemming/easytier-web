<script setup lang="ts">
// Underlined inline action used by the settings rows (mockup option C).
withDefaults(defineProps<{ loading?: boolean; disabled?: boolean }>(), {})
</script>

<template>
  <button
    type="button"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
    class="inline-flex cursor-pointer items-center gap-1.5 rounded-control text-[13px] whitespace-nowrap text-ink underline decoration-hairline-strong underline-offset-[3px] hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span
      v-if="loading"
      class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
