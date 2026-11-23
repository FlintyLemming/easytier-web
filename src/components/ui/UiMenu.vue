<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'

export interface UiMenuItem {
  label: string
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  hint?: string
}

defineProps<{ items: UiMenuItem[] }>()
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="6"
        class="z-50 min-w-44 rounded-card border border-hairline bg-surface-card p-1"
      >
        <template v-for="(item, i) in items" :key="i">
          <DropdownMenuSeparator v-if="item.separator" class="my-1 h-px bg-hairline" />
          <DropdownMenuItem
            v-else
            :disabled="item.disabled"
            class="flex cursor-pointer items-center justify-between gap-4 rounded-control px-3 py-2 text-[14px] outline-none data-[highlighted]:bg-canvas data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
            :class="item.danger ? 'text-error' : 'text-ink'"
            @select="item.onSelect?.()"
          >
            <span>{{ item.label }}</span>
            <span v-if="item.hint" class="text-[12px] text-muted">{{ item.hint }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
