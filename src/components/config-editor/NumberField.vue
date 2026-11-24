<script setup lang="ts">
import { useId } from 'vue'
import { inputNumber } from './rules'

defineProps<{ label: string; error?: string; hint?: string; placeholder?: string; min?: number; max?: number }>()
/** null when blank. NaN (a required number left blank) shows as blank too. */
const model = defineModel<number | null | undefined>({ required: true })
const id = useId()
const hintId = useId()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="caption-uppercase text-muted">{{ label }}</label>
    <input
      :id="id"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      :value="typeof model === 'number' && Number.isFinite(model) ? model : ''"
      :placeholder="placeholder"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="hint ? hintId : undefined"
      class="h-10 w-full rounded-control border bg-surface-card px-3 font-mono text-[14px] text-ink placeholder:text-muted-soft focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      :class="error ? 'border-error' : 'border-hairline-strong'"
      @input="model = inputNumber($event)"
    />
    <p v-if="hint" :id="hintId" class="text-[12px] text-muted">{{ hint }}</p>
    <p v-if="error" class="text-[12px] text-error">{{ error }}</p>
  </div>
</template>
