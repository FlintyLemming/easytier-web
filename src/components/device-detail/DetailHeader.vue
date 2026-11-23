<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setMachineAlias } from '../../api/client'
import type { CentralNetworkSummary } from '../../api/types'
import { useToast } from '../../composables/useToast'
import type { DeviceView } from '../../domain/devices'
import { locationText } from '../../domain/format'
import { copyText } from '../../lib/clipboard'
import DeviceStatus from '../devices/DeviceStatus.vue'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'
import NetworkSwitcher from './NetworkSwitcher.vue'
import { errorMessage, refreshInventoryFresh } from './writes'

const props = withDefaults(
  defineProps<{
    device: DeviceView
    networkId: string | null
    ip: string | null
    allNetworks: CentralNetworkSummary[]
    now: Date
    /**
     * False in webhook mode or for a device without a machine id yet: no network switcher, no alias
     * editing, no delete (they act on the central device registry, which upstream answers with 404).
     */
    manage?: boolean
  }>(),
  { manage: true },
)
const emit = defineEmits<{ join: []; delete: [] }>()
const { t } = useI18n()
const toast = useToast()

const MAX_ALIAS = 64

const subline = computed(() =>
  [
    { text: props.device.os, mono: false },
    { text: locationText(props.device.location) ?? '', mono: false },
    { text: props.ip ?? '', mono: true },
  ].filter((p) => p.text),
)

// --- inline alias editing ---
const editing = ref(false)
const saving = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
const tooLong = computed(() => [...draft.value.trim()].length > MAX_ALIAS)

async function startEdit() {
  draft.value = props.device.alias ?? ''
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function cancel() {
  editing.value = false
}

/** Enter also confirms an IME candidate (common for Chinese aliases); only a plain Enter saves. */
function onEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  void commit()
}

async function commit() {
  if (!editing.value || saving.value || tooLong.value) return
  const alias = draft.value.trim()
  if (alias === (props.device.alias ?? '')) {
    editing.value = false
    return
  }
  saving.value = true
  try {
    await setMachineAlias(props.device.id, alias)
    editing.value = false
    toast.success(t('detail.renamed'))
    await refreshInventoryFresh()
  } catch (e) {
    toast.error(t('detail.renameFailed', { message: errorMessage(e) }))
  } finally {
    saving.value = false
  }
}

// --- ⋯ menu ---
async function copyId() {
  if (await copyText(props.device.id)) toast.success(t('detail.copied'))
  else toast.error(t('common.copyFailed'))
}

const menuItems = computed<UiMenuItem[]>(() => {
  if (props.device.pending) return []
  const copy: UiMenuItem = { label: t('devices.copyId'), onSelect: () => void copyId() }
  if (!props.manage) return [copy]
  return [copy, { label: '', separator: true }, { label: t('devices.delete'), danger: true, onSelect: () => emit('delete') }]
})
</script>

<template>
  <header class="flex flex-col gap-3">
    <nav :aria-label="t('detail.breadcrumb')" class="flex min-w-0 items-center text-[13px] text-muted">
      <RouterLink to="/devices" class="shrink-0 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{{ t('nav.devices') }}</RouterLink>
      <span class="mx-1.5 shrink-0" aria-hidden="true">/</span>
      <span class="truncate text-ink" aria-current="page">{{ device.name }}</span>
    </nav>

    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 class="min-w-0 max-w-full text-[22px] leading-8 font-normal tracking-[-0.11px] text-ink">
            <input
              v-if="editing"
              ref="input"
              v-model="draft"
              type="text"
              :aria-label="t('detail.aliasLabel')"
              :aria-invalid="tooLong ? 'true' : undefined"
              :placeholder="device.hostname || t('detail.aliasPlaceholder')"
              :disabled="saving"
              class="h-9 w-full max-w-[420px] rounded-control border bg-surface-card px-2 text-[20px] tracking-[-0.11px] text-ink focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              :class="tooLong ? 'border-error' : 'border-hairline-strong'"
              @keydown.enter="onEnter"
              @keydown.esc.prevent="cancel"
              @blur="commit"
            />
            <span v-else-if="!manage" class="block max-w-full truncate">{{ device.name }}</span>
            <button
              v-else
              type="button"
              :aria-label="t('detail.renameAria', { name: device.name })"
              :title="t('detail.renameAria', { name: device.name })"
              class="block max-w-full cursor-text truncate rounded-control text-left decoration-hairline-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              @click="startEdit"
            >
              {{ device.name }}
            </button>
          </h1>
          <DeviceStatus :device="device" :now="now" />
        </div>
        <p v-if="editing && tooLong" class="mt-1 text-[12px] text-error">{{ t('detail.aliasTooLong') }}</p>
        <p v-if="subline.length" data-testid="detail-subline" class="mt-1 text-[13px] break-words text-muted">
          <template v-for="(part, i) in subline" :key="i"><span v-if="i > 0"> · </span><span :class="part.mono ? 'font-mono' : ''">{{ part.text }}</span></template>
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <NetworkSwitcher
          v-if="manage && device.networks.length > 0"
          :device="device"
          :network-id="networkId"
          :all-networks="allNetworks"
          @join="emit('join')"
        />
        <UiMenu v-if="menuItems.length" :items="menuItems">
          <template #trigger>
            <button
              type="button"
              :aria-label="t('devices.actions')"
              class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
          </template>
        </UiMenu>
      </div>
    </div>
  </header>
</template>
