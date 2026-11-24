<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { getGatewayInfo, getNetwork } from '../api/client'
import type { CentralNetworkDetail, GatewayInfo } from '../api/types'
import ExecuteStep from '../components/migrate/ExecuteStep.vue'
import InventoryStep from '../components/migrate/InventoryStep.vue'
import NetworkStep from '../components/migrate/NetworkStep.vue'
import PreviewStep from '../components/migrate/PreviewStep.vue'
import ReportStep from '../components/migrate/ReportStep.vue'
import WizardSteps from '../components/migrate/WizardSteps.vue'
import { useLegacyInventory } from '../composables/useLegacyInventory'
import { useConfirm } from '../composables/useConfirm'
import { useToast } from '../composables/useToast'
import { planGroup, selectedPreviews, targetFromDetail, targetFromDraft, type ChangeKey, type TargetNetwork } from '../domain/migration/classify'
import { draftFromGroup, groupLegacy } from '../domain/migration/inventory'
import { loadJournal } from '../domain/migration/journal'
import type { DraftConflicts, NetworkDraft } from '../domain/migration/types'
import { useInventory } from '../stores/inventory'
import { useSession } from '../stores/session'

const { t } = useI18n()
const inventory = useInventory()
const session = useSession()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const legacy = useLegacyInventory()

watchEffect(() => {
  if (session.webhookMode) void router.replace('/')
})

const step = ref(1)
const groups = computed(() => groupLegacy(legacy.instances.value, legacy.devices.value, inventory.networks))
const groupName = ref<string | null>(null)
const group = computed(() => groups.value.find((g) => g.networkName === groupName.value) ?? null)

const draft = ref<NetworkDraft | null>(null)
const initialDraft = ref<NetworkDraft | null>(null)
const conflicts = ref<DraftConflicts>({ networkName: [], secret: [], connectivity: [], subnet: [] })
const serverUnion = ref<string[]>([])
const existing = ref<CentralNetworkDetail | null>(null)
const gateway = ref<GatewayInfo | null>(null)

/** The network the devices migrate into: the existing one, else the draft. */
const target = computed<TargetNetwork | null>(() => {
  if (existing.value) return targetFromDetail(existing.value, gateway.value)
  return draft.value ? targetFromDraft(draft.value) : null
})
/** The user's 迁移 / 暂不迁移 choice per device id (step 3). */
const choices = ref<Record<string, boolean>>({})
/** Confirmed changes per device id (step 3). */
const confirmed = ref<Record<string, ChangeKey[]>>({})

/** Members of the existing target network (none for a network the wizard will create). */
const targetMembers = computed(() => (existing.value ? (inventory.membersByNetwork[existing.value.network_id] ?? []) : []))
const previews = computed(() => {
  if (!group.value || !target.value) return []
  const selected = new Set(Object.entries(choices.value).filter(([, v]) => v).map(([k]) => k))
  return planGroup(group.value, legacy.devices.value, target.value, targetMembers.value, selected)
})

/** The devices step 4 migrates. */
const selected = computed(() => selectedPreviews(previews.value, choices.value))

/** True while step 4 runs: leaving asks first and stops after the current device. */
const running = ref(false)
const executeStep = ref<{ stop(): void } | null>(null)

onBeforeRouteLeave(async () => {
  if (!running.value) return true
  const ok = await confirm({
    title: t('migrate.execute.leaveTitle'),
    body: t('migrate.execute.leaveBody'),
    confirmLabel: t('migrate.execute.leave'),
  })
  if (ok) executeStep.value?.stop()
  return ok
})
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!running.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

/** Entering step 3 the first time for this group: every device starts at its default choice. */
function toPreview() {
  if (Object.keys(choices.value).length === 0) {
    choices.value = Object.fromEntries(previews.value.map((p) => [p.device.id, p.defaultSelected]))
  }
  toStep(3)
}

const hasJournal = ref(false)
function readJournal() {
  hasJournal.value = !!session.username && loadJournal(session.username).length > 0
}

onMounted(async () => {
  if (session.webhookMode) return
  readJournal()
  if (route.query.report === '1') step.value = 5
  gateway.value = await getGatewayInfo()
  await legacy.load()
})

async function selectGroup(name: string) {
  const g = groups.value.find((x) => x.networkName === name)
  if (!g) return
  groupName.value = name
  const d = draftFromGroup(g)
  draft.value = structuredClone(d.draft)
  initialDraft.value = d.draft
  conflicts.value = d.conflicts
  serverUnion.value = d.serverUnion
  existing.value = null
  choices.value = {}
  confirmed.value = {}
  if (g.targetNetworkId) {
    try {
      existing.value = await getNetwork(g.targetNetworkId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return
    }
  }
  step.value = 2
}

function toStep(n: number) {
  step.value = n
  window.scrollTo?.({ top: 0 })
}

function toReport() {
  readJournal()
  toStep(5)
}

/** From the report back to step 1: forget the chosen group and read the devices again. */
function toInventory() {
  readJournal()
  groupName.value = null
  choices.value = {}
  confirmed.value = {}
  if (route.query.report) void router.replace({ query: {} })
  toStep(1)
  void legacy.load()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-4">
      <h1 class="text-[26px] font-normal tracking-[-0.325px] text-ink">{{ t('migrate.title') }}</h1>
      <WizardSteps :step="step" />
    </header>

    <InventoryStep
      v-if="step === 1"
      :groups="groups"
      :offline="legacy.offline.value"
      :failed="legacy.failed.value"
      :loading="legacy.loading.value"
      :progress="legacy.progress.value"
      :networks="inventory.networks"
      :has-journal="hasJournal"
      @select="selectGroup"
      @retry="legacy.retry"
      @reload="legacy.load"
      @report="toStep(5)"
    />

    <NetworkStep
      v-else-if="step === 2 && group && draft && initialDraft"
      v-model="draft"
      :group="group"
      :existing="existing"
      :gateway-enabled="gateway?.enabled === true"
      :conflicts="conflicts"
      :server-union="serverUnion"
      :initial="initialDraft"
      @back="toStep(1)"
      @next="toPreview"
    />

    <PreviewStep
      v-else-if="step === 3 && group && target"
      v-model:choices="choices"
      v-model:confirmed="confirmed"
      :previews="previews"
      @back="toStep(2)"
      @next="toStep(4)"
    />

    <ExecuteStep
      v-else-if="step === 4 && group && target"
      ref="executeStep"
      v-model:running="running"
      :previews="selected"
      :target="target"
      :existing="existing"
      :draft="draft"
      :confirmed="confirmed"
      @back="toStep(3)"
      @report="toReport"
    />

    <ReportStep v-else-if="step === 5" @back="toInventory" @cleared="readJournal" />
  </div>
</template>
