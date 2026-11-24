<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getGatewayInfo, getNetwork } from '../api/client'
import type { CentralNetworkDetail, GatewayInfo } from '../api/types'
import InventoryStep from '../components/migrate/InventoryStep.vue'
import NetworkStep from '../components/migrate/NetworkStep.vue'
import WizardSteps from '../components/migrate/WizardSteps.vue'
import { useLegacyInventory } from '../composables/useLegacyInventory'
import { useToast } from '../composables/useToast'
import { targetFromDetail, targetFromDraft, type ChangeKey, type TargetNetwork } from '../domain/migration/classify'
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
      @next="toStep(3)"
    />
  </div>
</template>
