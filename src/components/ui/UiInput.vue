<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ label?: string; error?: string; mono?: boolean; placeholder?: string }>()
const model = defineModel<string>({ default: '' })
const id = useId()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="caption-uppercase text-muted">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      :placeholder="placeholder"
      :aria-invalid="error ? 'true' : undefined"
      class="h-10 w-full rounded-control border bg-surface-card px-3 text-[14px] text-ink placeholder:text-muted-soft outline-none focus:border-ink"
      :class="[error ? 'border-error' : 'border-hairline-strong', mono ? 'font-mono' : 'font-sans']"
    />
    <p v-if="error" class="text-[12px] text-error">{{ error }}</p>
  </div>
</template>
