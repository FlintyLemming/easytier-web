<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'text' | 'danger'
    size?: 'md' | 'sm'
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)

const variantClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-primary text-white active:bg-primary-active'
    case 'text':
      return 'bg-transparent text-ink hover:bg-surface-strong'
    case 'danger':
      return 'bg-surface-card text-error border border-error'
    default:
      return 'bg-surface-card text-ink border border-hairline-strong'
  }
})
const sizeClass = computed(() => (props.size === 'sm' ? 'h-[30px] px-3' : 'h-10 px-4'))
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
    class="inline-flex items-center justify-center gap-2 rounded-control text-[14px] font-medium whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    :class="[variantClass, sizeClass]"
  >
    <span
      v-if="loading"
      class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
