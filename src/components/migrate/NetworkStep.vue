<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { CentralNetworkDetail } from '../../api/types'
import type { DraftConflicts, LegacyGroup, NetworkDraft, ValueCount } from '../../domain/migration/types'
import { settingsErrors } from '../../domain/networks'
import NetworkSettingsFields from '../networks/NetworkSettingsFields.vue'
import KeyValueList from '../ui/KeyValueList.vue'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'

const props = defineProps<{
  group: LegacyGroup
  existing: CentralNetworkDetail | null
  gatewayEnabled: boolean
  conflicts: DraftConflicts
  serverUnion: string[]
  /** The draft as derived from the group, to tell when the name or secret was changed. */
  initial: NetworkDraft
}>()
const draft = defineModel<NetworkDraft>({ required: true })
const emit = defineEmits<{ back: []; next: [] }>()
const { t } = useI18n()
const showSecret = ref(false)

const errors = computed(() => settingsErrors(draft.value.form))
const nameMissing = computed(() => !draft.value.form.networkName.trim())
const secretMissing = computed(() => !draft.value.secret)
const valid = computed(() => props.existing !== null || (Object.keys(errors.value).length === 0 && !nameMissing.value && !secretMissing.value))
const split = computed(
  () => draft.value.form.networkName.trim() !== props.initial.form.networkName || draft.value.secret !== props.initial.secret,
)

const form = computed({
  get: () => draft.value.form,
  set: (f) => (draft.value = { ...draft.value, form: f }),
})
const secret = computed({
  get: () => draft.value.secret,
  set: (s) => (draft.value = { ...draft.value, secret: s }),
})

function useAllServers() {
  form.value = { ...form.value, method: 'Manual', peerUrls: [...props.serverUnion] }
}

const KINDS = ['networkName', 'secret', 'connectivity', 'subnet'] as const
const conflictRows = computed(() => KINDS.filter((k) => props.conflicts[k].length > 0))
function itemText(kind: (typeof KINDS)[number], v: ValueCount, i: number): string {
  const value = kind === 'secret' ? t('migrate.network.secretValue', { n: i + 1 }) : v.value || t('migrate.network.none')
  return t('migrate.network.conflictItem', { value, count: v.count })
}

const existingItems = computed(() => {
  const n = props.existing
  if (!n) return []
  const addresses = n.networking_method === 'PublicServer' ? (n.public_server_url ?? '') : (n.peer_urls ?? []).join(', ')
  return [
    { label: t('networks.field.networkName'), value: n.network_name, mono: true },
    { label: t('networks.field.method'), value: t(`networks.method.${n.networking_method}`) },
    { label: t('networks.field.peerUrls'), value: addresses || '—', mono: true },
    { label: t('networks.field.virtualCidr'), value: n.virtual_cidr || '—', mono: true },
  ]
})
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="wizard-step-network">
    <section v-if="existing" class="rounded-card border border-hairline bg-surface-card px-5 py-4">
      <p class="text-[14px] text-ink">{{ t('migrate.network.existing', { name: existing.display_name }) }}</p>
      <div class="mt-3"><KeyValueList :items="existingItems" /></div>
      <RouterLink
        :to="{ name: 'network', params: { networkId: existing.network_id }, query: { tab: 'settings' } }"
        class="mt-3 inline-block text-[14px] text-ink underline underline-offset-2"
      >{{ t('migrate.network.editExisting') }}</RouterLink>
    </section>

    <template v-else>
      <section v-if="conflictRows.length" data-testid="draft-conflicts" class="rounded-card border border-hairline bg-surface-card px-5 py-4">
        <h2 class="caption-uppercase text-muted">{{ t('migrate.network.conflicts') }}</h2>
        <dl class="mt-2 flex flex-col gap-2 text-[14px]">
          <div v-for="k in conflictRows" :key="k">
            <dt class="text-muted">{{ t(`migrate.network.conflictKinds.${k}`) }}</dt>
            <dd class="flex flex-col font-mono text-[13px] text-ink">
              <span v-for="(v, i) in conflicts[k]" :key="i">{{ itemText(k, v, i) }}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section class="rounded-card border border-hairline bg-surface-card px-5 py-4">
        <NetworkSettingsFields
          v-model="form"
          :gateway-enabled="gatewayEnabled"
          :errors="errors"
          :show-errors="true"
          :network-name-hint="nameMissing ? t('migrate.network.networkNameRequired') : undefined"
        />
        <UiButton v-if="serverUnion.length > 1" class="mt-3" size="sm" @click="useAllServers">
          {{ t('migrate.network.useAll', { n: serverUnion.length }) }}
        </UiButton>
        <div class="mt-4 flex items-end gap-2">
          <div class="min-w-0 flex-1">
            <UiInput
              v-model="secret"
              mono
              :type="showSecret ? 'text' : 'password'"
              autocomplete="off"
              :label="t('migrate.network.secret')"
              :error="secretMissing ? t('migrate.network.secretRequired') : undefined"
            />
          </div>
          <UiButton variant="text" :class="secretMissing ? 'mb-6' : ''" @click="showSecret = !showSecret">
            {{ showSecret ? t('migrate.network.hide') : t('migrate.network.show') }}
          </UiButton>
        </div>
        <p v-if="split" class="mt-3 text-[13px] text-error" role="note">{{ t('migrate.network.splitWarning') }}</p>
      </section>
    </template>

    <div class="flex justify-between gap-3">
      <UiButton @click="emit('back')">{{ t('migrate.back') }}</UiButton>
      <UiButton variant="primary" :disabled="!valid" @click="emit('next')">{{ t('migrate.next') }}</UiButton>
    </div>
  </div>
</template>
