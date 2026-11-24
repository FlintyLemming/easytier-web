<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { InstanceRow } from '../../domain/instances'
import CopyButton from '../ui/CopyButton.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'

// One manual instance: a table row on wide screens, a card below 640px (`card`).
const props = defineProps<{
  row: InstanceRow
  card: boolean
  /** An action on this instance is under way: its menu is disabled. */
  busy?: boolean
  /** The editor is being opened (an edit or an import is reading): 编辑 waits for it. */
  editLocked?: boolean
}>()
const emit = defineEmits<{ edit: []; vpn: []; toggle: []; export: []; delete: [] }>()
const { t } = useI18n()

const disabled = computed(() => props.row.state === 'disabled')
const statusText = computed(() =>
  props.row.state === 'error'
    ? t('instances.state.error', { message: props.row.errorMsg ?? '' })
    : t(`instances.state.${props.row.state}`),
)

// Named after the instance, so each row's menu is told apart (also from the page header's 更多操作).
const menuLabel = computed(() => t('instances.menu.label', { name: props.row.name }))

const items = computed<UiMenuItem[]>(() => [
  ...(props.row.editable ? [{ label: t('instances.menu.edit'), disabled: props.editLocked, onSelect: () => emit('edit') }] : []),
  // Only a running instance has a VPN Portal to ask about.
  ...(props.row.state === 'running' ? [{ label: t('instances.menu.vpnPortal'), onSelect: () => emit('vpn') }] : []),
  { label: disabled.value ? t('instances.menu.enable') : t('instances.menu.disable'), onSelect: () => emit('toggle') },
  { label: t('instances.menu.export'), onSelect: () => emit('export') },
  ...(props.row.deletable
    ? [{ label: '', separator: true }, { label: t('instances.menu.delete'), danger: true, onSelect: () => emit('delete') }]
    : []),
])
</script>

<template>
  <tr v-if="!card" data-testid="instance-row" class="border-t border-hairline-soft first:border-t-0">
    <td class="min-w-0 py-3 pr-3 pl-5 align-middle">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-[14px] font-medium text-ink" :title="row.name">{{ row.name }}</span>
        <UiBadge v-if="row.local" tone="outline" class="shrink-0">{{ t('instances.local') }}</UiBadge>
      </div>
      <div class="flex min-w-0 items-center gap-1">
        <span class="truncate font-mono text-[12px] text-muted" :title="row.id">{{ row.id }}</span>
        <CopyButton :text="row.id" class="shrink-0" />
      </div>
    </td>
    <td class="px-3 py-3 align-middle">
      <span v-if="row.state === 'error'" class="line-clamp-2 text-[13px] break-words text-error" :title="statusText">{{ statusText }}</span>
      <span v-else class="inline-flex items-center gap-2 text-[13px] text-body">
        <span class="h-[7px] w-[7px] shrink-0 rounded-pill" :class="row.state === 'running' ? 'bg-success' : 'bg-muted-soft'" aria-hidden="true" />
        {{ statusText }}
      </span>
    </td>
    <td class="truncate px-3 py-3 align-middle font-mono text-[13px] text-ink">{{ row.ipv4 ?? '—' }}</td>
    <td class="py-3 pr-3 pl-2 text-right align-middle">
      <UiMenu :items="items">
        <template #trigger>
          <button
            type="button"
            :aria-label="menuLabel"
            :disabled="busy"
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        </template>
      </UiMenu>
    </td>
  </tr>

  <li v-else data-testid="instance-card" class="flex flex-col gap-2 border-t border-hairline-soft px-4 py-3 first:border-t-0">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-[14px] font-medium text-ink" :title="row.name">{{ row.name }}</span>
          <UiBadge v-if="row.local" tone="outline">{{ t('instances.local') }}</UiBadge>
        </div>
        <div class="flex min-w-0 items-center gap-1">
          <span class="truncate font-mono text-[12px] text-muted" :title="row.id">{{ row.id }}</span>
          <CopyButton :text="row.id" class="shrink-0" />
        </div>
      </div>
      <UiMenu :items="items">
        <template #trigger>
          <button
            type="button"
            :aria-label="menuLabel"
            :disabled="busy"
            class="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        </template>
      </UiMenu>
    </div>
    <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <span v-if="row.state === 'error'" class="min-w-0 text-[13px] break-words text-error">{{ statusText }}</span>
      <span v-else class="inline-flex items-center gap-2 text-[13px] text-body">
        <span class="h-[7px] w-[7px] shrink-0 rounded-pill" :class="row.state === 'running' ? 'bg-success' : 'bg-muted-soft'" aria-hidden="true" />
        {{ statusText }}
      </span>
      <span class="font-mono text-[13px] text-ink">{{ row.ipv4 ?? '—' }}</span>
    </div>
  </li>
</template>
