<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

defineProps<{ title: string }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-ink/30" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline bg-surface-card p-6 outline-none"
        :aria-describedby="undefined"
      >
        <DialogTitle class="text-[22px] font-normal tracking-[-0.11px] text-ink">{{ title }}</DialogTitle>
        <div class="mt-3 text-[14px] text-body"><slot /></div>
        <div v-if="$slots.footer" class="mt-6 flex justify-end gap-2"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
