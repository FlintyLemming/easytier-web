<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { getAclPolicy } from '../../api/client'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { clearJournal, loadJournal, upsertRecord, type MigrationRecord } from '../../domain/migration/journal'
import { rollbackDevice, verifyDevice } from '../../domain/migration/run'
import { downloadText } from '../../lib/download'
import { useSession } from '../../stores/session'
import EmptyState from '../ui/EmptyState.vue'
import UiButton from '../ui/UiButton.vue'
import { fileStamp, migrationApi } from './migrationApi'

const emit = defineEmits<{ back: []; cleared: [] }>()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const session = useSession()

const records = ref<MigrationRecord[]>(loadJournal(session.username))
const keyOf = (r: MigrationRecord) => `${r.networkId}/${r.deviceId}`
/** Records being verified now. */
const checking = ref(new Set<string>())
/** The record being rolled back (one at a time). */
const rollingBack = ref<string | null>(null)

const sorted = computed(() =>
  [...records.value].sort((a, b) => a.networkName.localeCompare(b.networkName) || a.deviceName.localeCompare(b.deviceName)),
)
const canClear = computed(() => records.value.length > 0 && records.value.every((r) => r.status === 'consistent' || r.status === 'rolledBack'))

/** Per network: the devices whose legacy ACL was confirmed as not migrated (spec: write it as central rules). */
const aclNotes = computed(() => {
  const by = new Map<string, string[]>()
  for (const r of sorted.value) {
    if (r.status === 'rolledBack' || !r.confirmed.includes('acl')) continue
    by.set(r.networkId, [...(by.get(r.networkId) ?? []), r.deviceName])
  }
  return [...by].map(([networkId, names]) => ({ networkId, names: names.join('、') }))
})

async function verify(rec: MigrationRecord) {
  const key = keyOf(rec)
  checking.value = new Set(checking.value).add(key)
  try {
    const r = await verifyDevice(migrationApi, rec)
    // Unreachable keeps the last known status: a migrated device stays 「等待上线后校验」.
    if (r.status === 'unreachable') return
    const current = records.value.find((x) => keyOf(x) === key)
    if (!current || current.status === 'rolledBack') return
    records.value = upsertRecord(session.username, {
      ...current,
      status: r.status,
      checkedAt: Date.now(),
      diffs: r.status === 'mismatch' ? r.diffs : undefined,
    })
  } finally {
    const next = new Set(checking.value)
    next.delete(key)
    checking.value = next
  }
}

function verifyAll(onlyUnsettled: boolean) {
  const todo = records.value.filter((r) => r.status !== 'rolledBack' && !(onlyUnsettled && r.status === 'consistent'))
  return Promise.all(todo.map(verify))
}

onMounted(() => void verifyAll(true))

function statusText(r: MigrationRecord): string {
  if (checking.value.has(keyOf(r))) return t('migrate.report.checking')
  switch (r.status) {
    case 'consistent':
      return t('migrate.report.consistent')
    case 'mismatch':
      return t('migrate.report.mismatch')
    case 'rolledBack':
      return t('migrate.report.rolledBack')
    default:
      return t('migrate.report.waiting')
  }
}
function statusClass(r: MigrationRecord): string {
  if (checking.value.has(keyOf(r))) return 'text-muted'
  if (r.status === 'consistent') return 'text-success'
  if (r.status === 'mismatch') return 'text-error'
  return 'text-muted'
}

const show = (v: unknown) => (v === undefined || v === null ? t('migrate.report.none') : typeof v === 'string' ? v : JSON.stringify(v))

async function rollback(rec: MigrationRecord) {
  if (rollingBack.value) return
  let aclTrimmed = true
  try {
    aclTrimmed = (await getAclPolicy(rec.networkId)).rules.length > 0
  } catch { /* unknown: keep the warning */ }
  const body =
    t('migrate.report.rollbackBody', { name: rec.deviceName, network: rec.networkName }) +
    (aclTrimmed ? t('migrate.report.rollbackAcl') : '')
  const ok = await confirm({
    title: t('migrate.report.rollbackTitle', { name: rec.deviceName }),
    body,
    confirmLabel: t('migrate.report.rollbackConfirm'),
    danger: true,
  })
  if (!ok) return
  const key = keyOf(rec)
  rollingBack.value = key
  try {
    const r = await rollbackDevice(migrationApi, rec, { onStep: () => {}, record: () => {} })
    if (!r.ok) {
      toast.error(t('migrate.report.rollbackFailed', { name: rec.deviceName, message: r.message }))
      return
    }
    const current = records.value.find((x) => keyOf(x) === key) ?? rec
    records.value = upsertRecord(session.username, { ...current, status: 'rolledBack', checkedAt: Date.now(), diffs: undefined })
    toast.success(t('migrate.report.rollbackDone', { name: rec.deviceName }))
  } finally {
    rollingBack.value = null
  }
}

function download() {
  downloadText(`easytier-migration-record-${fileStamp(new Date())}.json`, JSON.stringify(records.value, null, 2) + '\n', 'application/json')
}

async function clear() {
  if (!canClear.value) return
  const ok = await confirm({
    title: t('migrate.report.clearTitle'),
    body: t('migrate.report.clearBody'),
    confirmLabel: t('migrate.report.clearConfirm'),
    danger: true,
  })
  if (!ok) return
  clearJournal(session.username)
  records.value = []
  emit('cleared')
}

const anyChecking = computed(() => checking.value.size > 0)
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="wizard-step-report">
    <section
      v-for="n in aclNotes"
      :key="n.networkId"
      class="rounded-card border border-hairline bg-surface-card px-5 py-4 text-[14px]"
    >
      <p class="text-ink">{{ t('migrate.report.aclDevices', { names: n.names }) }}</p>
      <RouterLink
        :to="{ name: 'network', params: { networkId: n.networkId }, query: { tab: 'acl' } }"
        class="mt-2 inline-block text-ink underline underline-offset-2"
      >{{ t('migrate.report.aclLink') }}</RouterLink>
    </section>

    <section class="rounded-card border border-hairline bg-surface-card">
      <EmptyState v-if="records.length === 0" :title="t('migrate.report.empty')" :body="t('migrate.report.emptyBody')" />
      <template v-else>
        <div class="flex flex-wrap items-center gap-3 border-b border-hairline-soft px-5 py-3">
          <UiButton size="sm" :loading="anyChecking" @click="verifyAll(false)">{{ t('migrate.report.reverify') }}</UiButton>
          <UiButton size="sm" @click="download">{{ t('migrate.report.download') }}</UiButton>
          <span class="text-[12px] text-muted">{{ t('migrate.report.secretNote') }}</span>
        </div>
        <ul>
          <li
            v-for="r in sorted"
            :key="keyOf(r)"
            data-testid="report-device"
            class="flex flex-col gap-2 border-b border-hairline-soft px-5 py-3 last:border-b-0"
          >
            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div class="min-w-0">
                <p class="truncate text-[14px] text-ink">{{ r.deviceName }}</p>
                <p class="truncate font-mono text-[12px] text-muted">{{ r.networkName }}</p>
              </div>
              <div class="flex items-center gap-3">
                <span data-testid="report-status" class="text-[13px]" :class="statusClass(r)">{{ statusText(r) }}</span>
                <UiButton
                  v-if="r.status !== 'rolledBack'"
                  size="sm"
                  :loading="rollingBack === keyOf(r)"
                  :disabled="rollingBack !== null && rollingBack !== keyOf(r)"
                  @click="rollback(r)"
                >{{ t('migrate.report.rollback') }}</UiButton>
              </div>
            </div>
            <ul v-if="r.status === 'mismatch' && r.diffs?.length" class="flex flex-col gap-1 font-mono text-[12px] text-ink">
              <li v-for="d in r.diffs" :key="d.field" class="break-all">
                {{ t('migrate.report.diff', { field: d.field, expected: show(d.expected), actual: show(d.actual) }) }}
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </section>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <UiButton variant="text" @click="emit('back')">{{ t('migrate.report.toInventory') }}</UiButton>
      <div v-if="records.length" class="flex flex-wrap items-center gap-3">
        <span v-if="!canClear" class="text-[12px] text-muted">{{ t('migrate.report.clearHint') }}</span>
        <UiButton variant="danger" :disabled="!canClear" @click="clear">{{ t('migrate.report.clear') }}</UiButton>
      </div>
    </div>
  </div>
</template>
