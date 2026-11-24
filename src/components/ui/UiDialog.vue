<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

/** `lg` is a wide, fixed-height dialog whose body scrolls between the title and the footer. */
withDefaults(defineProps<{ title: string; size?: 'md' | 'lg' }>(), { size: 'md' })
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-ink/30" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-hairline bg-surface-card p-6 outline-none"
        :class="size === 'lg' ? 'flex h-[min(calc(100dvh-32px),960px)] max-w-3xl flex-col' : 'max-w-md'"
        :aria-describedby="undefined"
      >
        <DialogTitle class="text-[22px] font-normal tracking-[-0.11px] text-ink">{{ title }}</DialogTitle>
        <!-- The padding keeps focus outlines of edge controls inside the scroll box. -->
        <div class="mt-3 text-[14px] text-body" :class="size === 'lg' ? '-mx-2 min-h-0 flex-1 overflow-y-auto px-2 py-1' : ''"><slot /></div>
        <div v-if="$slots.footer" class="mt-6 flex justify-end gap-2" :class="size === 'lg' ? 'flex-wrap' : ''"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
