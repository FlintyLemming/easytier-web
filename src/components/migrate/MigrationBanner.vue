<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { runningLegacyIds } from '../../domain/migration/inventory'
import { loadJournal } from '../../domain/migration/journal'
import { useInventory } from '../../stores/inventory'
import { useSession } from '../../stores/session'

/**
 * Overview banner (spec §5.10.2 entry): running legacy instances from the heartbeats, and migrated
 * devices still waiting for verification in this browser's journal. Costs no request. Dismissing
 * remembers what was shown; it comes back once that changes.
 */
const { t } = useI18n()
const inventory = useInventory()
const session = useSession()

const legacyIds = computed(() => runningLegacyIds(inventory.machines, inventory.networks))
const pending = ref<string[]>([])
/** Devices whose migration did not finish (cut off, or a rollback that failed). */
const unfinished = ref<string[]>([])
watch(
  () => [session.username, inventory.lastUpdatedAt],
  () => {
    const records = session.username ? loadJournal(session.username) : []
    const keys = (pick: (s: string) => boolean) => records.filter((r) => pick(r.status)).map((r) => `${r.networkId}/${r.deviceId}`).sort()
    pending.value = keys((s) => s === 'migrated')
    unfinished.value = keys((s) => s === 'inProgress' || s === 'needsAttention')
  },
  { immediate: true },
)

const signature = computed(() => `${legacyIds.value.join(',')}|${pending.value.join(',')}|${unfinished.value.join(',')}`)
const key = computed(() => `et.migrate.banner.${session.username}`)
const dismissed = ref<string | null>(null)
watch(
  key,
  (k) => {
    try {
      dismissed.value = localStorage.getItem(k)
    } catch {
      dismissed.value = null
    }
  },
  { immediate: true },
)

const visible = computed(
  () =>
    !session.webhookMode &&
    inventory.loaded &&
    (legacyIds.value.length > 0 || pending.value.length > 0 || unfinished.value.length > 0) &&
    dismissed.value !== signature.value,
)

function dismiss() {
  dismissed.value = signature.value
  try {
    localStorage.setItem(key.value, signature.value)
  } catch { /* ignore */ }
}
</script>

<template>
  <div
    v-if="visible"
    data-testid="migration-banner"
    role="status"
    class="flex items-start justify-between gap-3 rounded-card border border-hairline bg-surface-card px-5 py-3 text-[14px] text-ink"
  >
    <div class="flex min-w-0 flex-col gap-1">
      <p v-if="legacyIds.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{{ t('migrate.banner.legacy', { n: legacyIds.length }) }}</span>
        <RouterLink :to="{ name: 'migrate' }" class="font-medium text-ink underline underline-offset-2">{{ t('migrate.banner.start') }}</RouterLink>
      </p>
      <p v-if="unfinished.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="text-error">{{ t('migrate.banner.unfinished', { n: unfinished.length }) }}</span>
        <RouterLink :to="{ name: 'migrate', query: { report: '1' } }" class="font-medium text-ink underline underline-offset-2">{{ t('migrate.banner.view') }}</RouterLink>
      </p>
      <p v-if="pending.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{{ t('migrate.banner.pending', { n: pending.length }) }}</span>
        <RouterLink :to="{ name: 'migrate', query: { report: '1' } }" class="font-medium text-ink underline underline-offset-2">{{ t('migrate.banner.view') }}</RouterLink>
      </p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-control px-2 text-[16px] leading-6 text-muted hover:bg-surface-strong hover:text-ink"
      :aria-label="t('migrate.banner.close')"
      @click="dismiss"
    >
      ×
    </button>
  </div>
</template>
