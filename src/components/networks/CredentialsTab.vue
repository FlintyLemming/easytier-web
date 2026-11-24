<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listCredentials, revokeCredential } from '../../api/client'
import type { NetworkCredential } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useNarrow } from '../../composables/useNarrow'
import { usePolling } from '../../composables/usePolling'
import { useToast } from '../../composables/useToast'
import { elapsedText } from '../../domain/format'
import { credentialMemberId, memberName } from '../../domain/networks'
import { useInventory } from '../../stores/inventory'
import { errorMessage } from '../device-detail/writes'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'
import CredentialJoinDialog from './CredentialJoinDialog.vue'
import GenerateCredentialDialog from './GenerateCredentialDialog.vue'
import { networkDetailKey } from './context'

/** `active`: the tab is showing; the list polls every 5 s only then (online peers change). */
const props = defineProps<{ networkId: string; active: boolean }>()
const { t, locale } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const inventory = useInventory()
const narrow = useNarrow(640)
const ctx = inject(networkDetailKey)!

const now = ref(new Date())
const tick = setInterval(() => { now.value = new Date() }, 30_000)
onBeforeUnmount(() => clearInterval(tick))

const list = ref<NetworkCredential[] | null>(null)
const loadError = ref<string | null>(null)
const refreshFailed = ref(false)

async function load() {
  try {
    list.value = await listCredentials(props.networkId)
    loadError.value = null
    refreshFailed.value = false
  } catch (e) {
    if (list.value === null) loadError.value = errorMessage(e)
    else refreshFailed.value = true
  }
}
const poller = usePolling(load, 5000)
watch(() => props.active, (on) => (on ? poller.start() : poller.stop()), { immediate: true })

const rows = computed(() => [...(list.value ?? [])].sort((a, b) => a.expiry_unix - b.expiry_unix))

const membersById = computed(() => new Map((inventory.membersByNetwork[props.networkId] ?? []).map((m) => [m.member_id, m])))
function owner(c: NetworkCredential): string | null {
  const id = credentialMemberId(c.credential_id)
  if (id === null) return null
  const m = membersById.value.get(id)
  return m ? t('credentials.memberOf', { name: memberName(m) }) : t('credentials.memberUnknown')
}
function expiry(c: NetworkCredential): { text: string; expired: boolean } {
  const at = new Date(c.expiry_unix * 1000)
  if (at.getTime() <= now.value.getTime()) return { text: t('credentials.expired'), expired: true }
  return { text: t('credentials.expires', { time: elapsedText(now.value.toISOString(), at, locale.value === 'en' ? 'en' : 'zh-CN') }), expired: false }
}
function hosts(c: NetworkCredential): string {
  const names = c.online_peers.map((p) => p.hostname || `#${p.peer_id}`)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} ${t('credentials.moreHosts', { n: names.length - 3 })}`
}

const generating = ref(false)
const joining = ref<NetworkCredential | null>(null)
async function onGenerated(c: NetworkCredential) {
  await load()
  joining.value = c
}

const revoking = ref(false)
async function revoke(c: NetworkCredential) {
  if (revoking.value) return
  const ok = await confirm({
    title: t('credentials.revokeTitle'),
    body: t('credentials.revokeBody', { id: c.credential_id }),
    confirmLabel: t('credentials.revokeConfirm'),
    danger: true,
  })
  if (!ok) return
  revoking.value = true
  try {
    await revokeCredential(props.networkId, c.credential_id)
    toast.success(t('credentials.revoked', { id: c.credential_id }))
    await load()
  } catch (e) {
    toast.error(t('credentials.revokeFailed', { message: errorMessage(e) }))
  } finally {
    revoking.value = false
  }
}

function items(c: NetworkCredential): UiMenuItem[] {
  const member = credentialMemberId(c.credential_id) !== null
  return [
    { label: t('credentials.menu.join'), onSelect: () => { joining.value = c } },
    { label: '', separator: true },
    {
      label: t('credentials.menu.revoke'),
      danger: true,
      disabled: member || revoking.value,
      hint: member ? t('credentials.menu.revokeMemberHint') : undefined,
      onSelect: () => void revoke(c),
    },
  ]
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p v-if="list" class="text-[14px] text-muted">{{ t('credentials.count', { n: list.length }, list.length) }}</p>
        <p class="text-[12px] text-muted">{{ t('credentials.hint') }}</p>
      </div>
      <UiButton @click="generating = true">{{ t('credentials.generate') }}</UiButton>
    </div>

    <EmptyState v-if="loadError !== null" :title="t('credentials.loadFailed')" :body="loadError">
      <template #action><UiButton @click="load">{{ t('credentials.retry') }}</UiButton></template>
    </EmptyState>
    <SkeletonRows v-else-if="list === null" :rows="3" />
    <template v-else>
      <p v-if="refreshFailed" class="border-y border-hairline py-2 text-[13px] text-muted">{{ t('credentials.refreshFailed') }}</p>
      <div v-if="rows.length === 0" class="rounded-card border border-hairline bg-surface-card">
        <EmptyState :title="t('credentials.empty')" />
      </div>
      <ul v-else class="rounded-card border border-hairline bg-surface-card">
        <li
          v-for="c in rows"
          :key="c.credential_id"
          data-testid="credential-row"
          class="flex items-start gap-3 border-t border-hairline-soft px-4 py-3 first:border-t-0"
          :class="narrow ? 'flex-col' : ''"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-[13px] text-ink" :title="c.credential_id">{{ c.credential_id }}</div>
            <div v-if="owner(c)" class="text-[12px] text-muted">{{ owner(c) }}</div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
            <span :class="expiry(c).expired ? 'text-muted-soft' : 'text-body'">{{ expiry(c).text }}</span>
            <span class="text-body">{{ c.reusable ? t('credentials.reusable') : t('credentials.oneTime') }}</span>
            <span class="text-body">
              {{ t('credentials.cols.online') }} {{ c.online_peers.length }}
              <span v-if="c.online_peers.length" class="block text-[12px] text-muted">{{ hosts(c) }}</span>
            </span>
            <UiMenu :items="items(c)">
              <template #trigger>
                <button
                  type="button"
                  :aria-label="t('credentials.menuLabel', { id: c.credential_id })"
                  class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                </button>
              </template>
            </UiMenu>
          </div>
        </li>
      </ul>
    </template>

    <GenerateCredentialDialog v-model:open="generating" :network-id="networkId" @generated="onGenerated" />
    <CredentialJoinDialog :credential="joining" :detail="ctx.detail.value" :gateway="ctx.gateway.value" @close="joining = null" />
  </div>
</template>
