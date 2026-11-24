<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { elapsedText } from '../../domain/format'
import type { MemberRow } from '../../domain/networks'
import { useToast } from '../../composables/useToast'
import { copyText } from '../../lib/clipboard'
import StatusDot from '../ui/StatusDot.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'

/** One member: a table row on wide screens, a card on narrow ones (like the device list). */
const props = defineProps<{ member: MemberRow; networkId: string; os: string; now: Date; narrow: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const { t, locale } = useI18n()
const router = useRouter()
const toast = useToast()

const expiry = computed(() => {
  if (props.member.expiryUnix === null) return null
  const at = new Date(props.member.expiryUnix * 1000)
  if (at.getTime() <= props.now.getTime()) return t('network.members.expired')
  return t('network.members.expires', { time: elapsedText(props.now.toISOString(), at, locale.value === 'en' ? 'en' : 'zh-CN') })
})

const stateText = computed(() =>
  props.member.state === 'error'
    ? t('network.members.state.error', { message: props.member.errorMsg ?? '' })
    : t(`network.members.state.${props.member.state}`),
)

async function copy(text: string) {
  if (await copyText(text)) toast.success(t('network.members.copied'))
  else toast.error(t('common.copyFailed'))
}

const items = computed<UiMenuItem[]>(() => [
  { label: t('network.members.menu.copyIp'), disabled: !props.member.ip, onSelect: () => props.member.ip && copy(props.member.ip) },
  { label: t('network.members.menu.copyId'), onSelect: () => copy(props.member.deviceId) },
  { label: '', separator: true },
  { label: t('network.members.menu.remove'), danger: true, onSelect: () => emit('remove') },
])

function open() {
  void router.push({ name: 'device-network', params: { machineId: props.member.deviceId, networkId: props.networkId } })
}
function onClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, label')) return
  open()
}
function onEnter(e: KeyboardEvent) {
  if (e.target === e.currentTarget) open()
}
</script>

<template>
  <li
    v-if="narrow"
    data-testid="member-card"
    tabindex="0"
    class="cursor-pointer rounded-card border border-hairline bg-surface-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    @click="onClick"
    @keydown.enter="onEnter"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[14px] font-medium text-ink" :title="member.name">{{ member.name }}</span>
          <UiBadge v-if="member.temporary" tone="outline">{{ t('network.members.temporary') }}</UiBadge>
        </div>
        <div class="truncate text-[12px] text-muted">{{ os || '—' }}<template v-if="expiry"> · {{ expiry }}</template></div>
      </div>
      <UiMenu :items="items">
        <template #trigger>
          <button
            type="button"
            :aria-label="t('network.members.menuLabel', { name: member.name })"
            class="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click.stop
            @keydown.enter.stop
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          </button>
        </template>
      </UiMenu>
    </div>
    <div class="mt-3 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="truncate font-mono text-[13px] text-ink">{{ member.ip ?? '—' }}</div>
        <div v-if="member.ipKind !== 'none'" class="text-[12px] text-muted">{{ member.ipKind === 'fixed' ? t('network.members.ipFixed') : t('network.members.ipAuto') }}</div>
      </div>
      <span v-if="member.state === 'error'" class="min-w-0 truncate text-[13px] text-error" :title="stateText">{{ stateText }}</span>
      <span v-else class="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-body"><StatusDot :online="member.state === 'running'" />{{ stateText }}</span>
    </div>
  </li>
  <tr
    v-else
    data-testid="member-row"
    tabindex="0"
    class="cursor-pointer border-t border-hairline-soft hover:bg-canvas-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
    @click="onClick"
    @keydown.enter="onEnter"
  >
    <td class="min-w-0 px-4 py-3 align-middle">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-[14px] font-medium text-ink" :title="member.name">{{ member.name }}</span>
        <UiBadge v-if="member.temporary" tone="outline">{{ t('network.members.temporary') }}</UiBadge>
      </div>
      <div class="truncate text-[12px] text-muted">{{ os || '—' }}<template v-if="expiry"> · {{ expiry }}</template></div>
    </td>
    <td class="min-w-0 px-4 py-3 align-middle">
      <div class="truncate font-mono text-[13px] text-ink">{{ member.ip ?? '—' }}</div>
      <div v-if="member.ipKind !== 'none'" class="text-[12px] text-muted">{{ member.ipKind === 'fixed' ? t('network.members.ipFixed') : t('network.members.ipAuto') }}</div>
    </td>
    <td class="px-4 py-3 align-middle"><span class="truncate font-mono text-[13px] text-ink">{{ member.version || '—' }}</span></td>
    <td class="min-w-0 px-4 py-3 align-middle">
      <span v-if="member.state === 'error'" class="block truncate text-[13px] text-error" :title="stateText">{{ stateText }}</span>
      <span v-else class="inline-flex items-center gap-1.5 text-[13px] text-body"><StatusDot :online="member.state === 'running'" />{{ stateText }}</span>
    </td>
    <td class="px-2 py-3 text-right align-middle">
      <UiMenu :items="items">
        <template #trigger>
          <button
            type="button"
            :aria-label="t('network.members.menuLabel', { name: member.name })"
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click.stop
            @keydown.enter.stop
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          </button>
        </template>
      </UiMenu>
    </td>
  </tr>
</template>
