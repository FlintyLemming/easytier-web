<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createNetwork } from '../../api/client'
import type { CentralNetworkDetail } from '../../api/types'
import { useToast } from '../../composables/useToast'
import type { ChangeKey, DevicePreview, TargetNetwork } from '../../domain/migration/classify'
import { exportFile, saveRecord } from '../../domain/migration/journal'
import { JOURNAL_NOT_SAVED, migrateDevice, type DeviceOutcome, type StepName } from '../../domain/migration/run'
import type { NetworkDraft } from '../../domain/migration/types'
import { settingsPayload } from '../../domain/networks'
import { downloadText } from '../../lib/download'
import { useInventory } from '../../stores/inventory'
import { useSession } from '../../stores/session'
import CheckboxField from '../config-editor/CheckboxField.vue'
import UiButton from '../ui/UiButton.vue'
import { changeLabel } from './changeText'
import { migrationApi } from './migrationApi'
import { holdUnload } from './unloadGuard'

const props = defineProps<{
  /** The devices that will migrate (step 3's selection). */
  previews: DevicePreview[]
  target: TargetNetwork
  /** The existing target network; null when the draft is created at the start. */
  existing: CentralNetworkDetail | null
  draft: NetworkDraft | null
  confirmed: Record<string, ChangeKey[]>
}>()
/** True from the start of the run until the last device is done (the page guards leaving). */
const running = defineModel<boolean>('running', { required: true })
const emit = defineEmits<{ back: []; report: [] }>()
const { t } = useI18n()
const toast = useToast()
const session = useSession()
const inventory = useInventory()

type RowState = { kind: 'pending' } | { kind: 'step'; step: StepName } | { kind: 'done'; outcome: DeviceOutcome }

/** The list as it was when the step opened: later polls (members joining) must not change it. */
const devices = [...props.previews]
const rows = ref<Record<string, RowState>>(Object.fromEntries(devices.map((p) => [p.device.id, { kind: 'pending' }])))
const backedUp = ref(false)
const phase = ref<'ready' | 'running' | 'done'>('ready')
const stopping = ref(false)
let stopRequested = false

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Finish (or roll back) the current device, then start no other. */
function stop() {
  stopRequested = true
  if (phase.value === 'running') stopping.value = true
}
defineExpose({ stop })

async function start() {
  if (phase.value !== 'ready' || !backedUp.value) return
  phase.value = 'running'
  running.value = true
  stopRequested = false
  // Captured once: a session that expires mid-run must not move later records to another key.
  const user = session.username
  // Released only when the loop ends, even if the page was left in between.
  const release = holdUnload()
  try {
    const file = exportFile(props.target.networkName, devices, new Date())
    downloadText(file.filename, file.text, 'application/json')

    let networkId = props.existing?.network_id ?? null
    if (!networkId) {
      try {
        const created = await createNetwork(settingsPayload(props.draft!.form), props.draft!.secret)
        networkId = created.network_id
        void inventory.refresh()
      } catch (e) {
        toast.error(message(e))
        phase.value = 'ready'
        return
      }
    }

    for (const p of devices) {
      if (stopRequested) break
      const id = p.device.id
      rows.value[id] = { kind: 'step', step: 'disable' }
      const outcome = await migrateDevice(
        migrationApi,
        {
          networkId,
          networkName: props.target.networkName,
          preview: p,
          target: props.target,
          confirmed: new Set(props.confirmed[id] ?? []),
          newIp: p.newIp,
        },
        {
          onStep: (step) => (rows.value[id] = { kind: 'step', step }),
          record: (rec) => saveRecord(user, rec).saved,
        },
      )
      rows.value[id] = { kind: 'done', outcome }
    }
    phase.value = 'done'
    void inventory.refresh()
  } finally {
    release()
    stopping.value = false
    running.value = false
  }
}

function statusText(s: RowState): string {
  if (s.kind === 'pending') return t('migrate.execute.status.pending')
  if (s.kind === 'step') return t(`migrate.execute.status.${s.step}`)
  const o = s.outcome
  switch (o.kind) {
    case 'migrated':
      return t('migrate.execute.status.migrated')
    case 'migratedKeptLegacy':
      return t('migrate.execute.status.migratedKeptLegacy', {
        message: o.message === JOURNAL_NOT_SAVED ? t('migrate.execute.journalNotSaved') : o.message,
      })
    case 'rolledBack': {
      const msg = o.changed?.length
        ? t('migrate.execute.changedSincePreview', { changes: o.changed.map((k) => changeLabel(t, k)).join('、') })
        : o.message
      return t('migrate.execute.status.rolledBack', { step: t(`migrate.execute.status.${o.step}`), message: msg })
    }
    case 'needsAttention':
      return t('migrate.execute.status.needsAttention', {
        step: t(`migrate.execute.status.${o.step}`),
        message: o.message,
        rollback: t(`migrate.execute.rollbackSteps.${o.rollbackStep}`),
      })
  }
}

function statusClass(s: RowState): string {
  if (s.kind !== 'done') return s.kind === 'step' ? 'text-ink' : 'text-muted'
  return s.outcome.kind === 'migrated' || s.outcome.kind === 'migratedKeptLegacy' ? 'text-success' : 'text-error'
}
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="wizard-step-execute">
    <section class="rounded-card border border-hairline bg-surface-card px-5 py-4">
      <p class="text-[14px] text-ink">{{ t('migrate.execute.intro', { n: devices.length, name: target.networkName }) }}</p>
      <template v-if="phase !== 'done'">
        <div class="mt-4">
          <CheckboxField v-model="backedUp" :label="t('migrate.execute.backedUp')" />
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <UiButton variant="primary" :disabled="!backedUp" :loading="phase === 'running'" @click="start">
            {{ t('migrate.execute.start') }}
          </UiButton>
          <span class="text-[12px] text-muted">{{ t('migrate.execute.secretNote') }}</span>
        </div>
      </template>
    </section>

    <section class="rounded-card border border-hairline bg-surface-card" :aria-label="t('migrate.execute.devices')">
      <ul>
        <li
          v-for="p in devices"
          :key="p.device.id"
          data-testid="execute-device"
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline-soft px-5 py-3 last:border-b-0"
        >
          <div class="min-w-0">
            <p class="truncate text-[14px] text-ink">{{ p.device.name }}</p>
            <p class="truncate font-mono text-[12px] text-muted">{{ p.instance.instanceId }}</p>
          </div>
          <p class="flex min-w-0 items-center gap-2 text-[13px] break-all" :class="statusClass(rows[p.device.id]!)" role="status">
            <span
              v-if="rows[p.device.id]!.kind === 'step'"
              class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            {{ statusText(rows[p.device.id]!) }}
          </p>
        </li>
      </ul>
    </section>

    <div class="flex justify-between gap-3">
      <UiButton v-if="phase === 'ready'" @click="emit('back')">{{ t('migrate.back') }}</UiButton>
      <UiButton v-else-if="phase === 'running'" :loading="stopping" @click="stop">{{ t('migrate.execute.stop') }}</UiButton>
      <UiButton v-else @click="emit('report')">{{ t('migrate.execute.toReport') }}</UiButton>
    </div>
  </div>
</template>
