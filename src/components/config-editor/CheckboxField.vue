<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ label: string; help?: string }>()
const checked = defineModel<boolean>({ required: true })
const id = useId()
const helpId = useId()
</script>

<template>
  <div class="flex items-start gap-2">
    <input
      :id="id"
      type="checkbox"
      :checked="checked"
      :aria-describedby="help ? helpId : undefined"
      class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-ink"
      @change="checked = ($event.target as HTMLInputElement).checked"
    />
    <div class="min-w-0">
      <label :for="id" class="cursor-pointer text-[14px] text-ink">{{ label }}</label>
      <p v-if="help" :id="helpId" class="text-[12px] whitespace-pre-line text-muted">{{ help }}</p>
    </div>
  </div>
</template>
