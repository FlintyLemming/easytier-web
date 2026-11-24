<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { createNetwork } from '../../api/client'
import type { GatewayInfo } from '../../api/types'
import { useToast } from '../../composables/useToast'
import { randomNetworkSecret, settingsErrors, settingsPayload, type SettingsForm } from '../../domain/networks'
import { errorMessage, refreshInventoryFresh } from '../device-detail/writes'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'
import NetworkSettingsFields from './NetworkSettingsFields.vue'

/** `gateway` is null until the page has read `/networks/gateway-info`; the form waits for it. */
const props = defineProps<{ gateway: GatewayInfo | null }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const toast = useToast()
const router = useRouter()

const form = ref<SettingsForm | null>(null)
const secret = ref('')
const showErrors = ref(false)
const busy = ref(false)

const gatewayEnabled = computed(() => props.gateway?.enabled === true)
const errors = computed(() => (form.value ? settingsErrors(form.value) : {}))
const invalid = computed(() => Object.keys(errors.value).length > 0)

function init() {
  const gw = gatewayEnabled.value
  form.value = {
    displayName: '',
    networkName: '',
    method: gw ? 'Gateway' : 'Manual',
    publicServerUrl: '',
    peerUrls: [],
    virtualCidr: '',
    // The built-in gateway speaks the Noise handshake, so secure mode defaults on for it (as upstream).
    secureMode: gw,
  }
  secret.value = ''
  showErrors.value = false
}

watch(
  [open, () => props.gateway],
  ([isOpen, gateway]) => {
    if (!isOpen) form.value = null
    else if (gateway && !form.value) init()
  },
  { immediate: true },
)

function setOpen(v: boolean) {
  if (!busy.value) open.value = v
}

async function submit() {
  if (!form.value || busy.value) return
  showErrors.value = true
  if (invalid.value) return
  busy.value = true
  try {
    const created = await createNetwork(settingsPayload(form.value), secret.value.trim() || undefined)
    toast.success(t('networks.created', { name: created.display_name }))
    busy.value = false
    open.value = false
    await refreshInventoryFresh()
    await router.push({ name: 'network', params: { networkId: created.network_id } })
  } catch (e) {
    toast.error(t('networks.createFailed', { message: errorMessage(e) }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiDialog :open="open" size="wide" :title="t('networks.new')" @update:open="setOpen">
    <SkeletonRows v-if="!form" :rows="4" />
    <form v-else id="create-network" class="flex flex-col gap-4" @submit.prevent="submit">
      <NetworkSettingsFields
        v-model="form"
        :gateway-enabled="gatewayEnabled"
        :errors="errors"
        :show-errors="showErrors"
        :network-name-placeholder="t('networks.field.networkNameHint')"
        :disabled="busy"
      />
      <div class="flex items-end gap-2">
        <div class="min-w-0 flex-1">
          <UiInput v-model="secret" mono :label="t('networks.field.secret')" :placeholder="t('networks.field.secretHint')" :disabled="busy" />
        </div>
        <UiButton variant="text" :disabled="busy" @click="secret = randomNetworkSecret()">{{ t('networks.field.randomSecret') }}</UiButton>
      </div>
    </form>
    <template #footer>
      <UiButton :disabled="busy" @click="setOpen(false)">{{ t('common.cancel') }}</UiButton>
      <UiButton type="submit" form="create-network" :loading="busy" :disabled="!form || (showErrors && invalid)">{{ t('networks.create') }}</UiButton>
    </template>
  </UiDialog>
</template>
