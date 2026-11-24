<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ title: string; name: string }>()
const headingId = useId()
</script>

<template>
  <section :aria-labelledby="headingId" :data-section="name" class="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
    <h3 :id="headingId" class="text-[16px] tracking-normal text-ink">{{ title }}</h3>
    <slot />
  </section>
</template>
