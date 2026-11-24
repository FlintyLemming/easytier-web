<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NetworkingMethod } from '../../api/types'
import { listenerRule } from '../config-editor/rules'
import CheckboxField from '../config-editor/CheckboxField.vue'
import ListField from '../config-editor/ListField.vue'
import { LABEL_CLASS } from '../config-editor/styles'
import UiInput from '../ui/UiInput.vue'
import { normalizeVirtualCidr, type SettingsError, type SettingsForm } from '../../domain/networks'

/** The network settings fields shared by the create dialog and the settings tab. */
const props = defineProps<{
  gatewayEnabled: boolean
  errors: Partial<Record<SettingsError, 'required' | 'url' | 'cidr'>>
  showErrors: boolean
  /** The network's stored method: a Gateway network keeps that option even when the gateway is off now. */
  currentMethod?: NetworkingMethod
  networkNameHint?: string
  networkNamePlaceholder?: string
  disabled?: boolean
}>()
const form = defineModel<SettingsForm>({ required: true })
const { t } = useI18n()
const groupId = useId()

const METHODS: NetworkingMethod[] = ['Gateway', 'PublicServer', 'Manual', 'Standalone']
const gatewaySelectable = computed(() => props.gatewayEnabled || props.currentMethod === 'Gateway')

function errorText(key: SettingsError): string | undefined {
  const e = props.errors[key]
  if (!e) return undefined
  // A list item's own format error shows under the item as soon as it is typed.
  if (key === 'peerUrls' && e === 'url') return undefined
  if (!props.showErrors) return undefined
  if (key === 'networkName') return t('networks.invalid.networkName')
  return t(`networks.invalid.${e}`)
}

const urlError = (v: string) => (v && listenerRule(v.trim()) ? t('networks.invalid.url') : undefined)

function set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
  form.value = { ...form.value, [key]: value }
}

function normalizeCidr() {
  const v = normalizeVirtualCidr(form.value.virtualCidr)
  if (v !== null && v !== form.value.virtualCidr) set('virtualCidr', v)
}
</script>

<template>
  <fieldset class="flex flex-col gap-4" :disabled="disabled">
    <UiInput
      :model-value="form.displayName"
      :label="t('networks.field.displayName')"
      :error="errorText('displayName')"
      @update:model-value="set('displayName', $event)"
    />
    <div class="flex flex-col gap-1">
      <UiInput
        :model-value="form.networkName"
        mono
        :label="t('networks.field.networkName')"
        :placeholder="networkNamePlaceholder"
        :error="errorText('networkName')"
        @update:model-value="set('networkName', $event)"
      />
      <p v-if="networkNameHint" class="text-[12px] text-muted">{{ networkNameHint }}</p>
    </div>

    <div role="radiogroup" :aria-labelledby="groupId" class="flex flex-col gap-1.5">
      <span :id="groupId" :class="LABEL_CLASS">{{ t('networks.field.method') }}</span>
      <div class="flex flex-wrap gap-x-5 gap-y-2">
        <label
          v-for="m in METHODS"
          :key="m"
          class="inline-flex items-center gap-2 text-[14px]"
          :class="m === 'Gateway' && !gatewaySelectable ? 'cursor-not-allowed text-muted-soft' : 'cursor-pointer text-ink'"
        >
          <input
            type="radio"
            :name="groupId"
            :value="m"
            :checked="form.method === m"
            :disabled="m === 'Gateway' && !gatewaySelectable"
            class="h-4 w-4 accent-ink"
            @change="set('method', m)"
          />
          {{ t(`networks.method.${m}`) }}
        </label>
      </div>
      <p v-if="!gatewaySelectable" class="text-[12px] text-muted">{{ t('networks.field.gatewayDisabled') }}</p>
    </div>

    <UiInput
      v-if="form.method === 'PublicServer'"
      :model-value="form.publicServerUrl"
      mono
      :label="t('networks.field.publicServerUrl')"
      placeholder="tcp://public.easytier.top:11010"
      :error="errorText('publicServerUrl')"
      @update:model-value="set('publicServerUrl', $event)"
    />
    <div v-if="form.method === 'Manual'" class="flex flex-col gap-1">
      <ListField
        :model-value="form.peerUrls"
        mono
        :label="t('networks.field.peerUrls')"
        placeholder="tcp://203.0.113.10:11010"
        :validate="urlError"
        @update:model-value="set('peerUrls', $event)"
      />
      <p v-if="errorText('peerUrls')" class="text-[12px] text-error">{{ errorText('peerUrls') }}</p>
    </div>

    <div class="flex flex-col gap-1" @focusout="normalizeCidr">
      <UiInput
        :model-value="form.virtualCidr"
        mono
        :label="t('networks.field.virtualCidr')"
        placeholder="10.144.144.0/24"
        :error="errorText('virtualCidr')"
        @update:model-value="set('virtualCidr', $event)"
      />
      <p class="text-[12px] text-muted">{{ t('networks.field.virtualCidrHint') }}</p>
    </div>

    <CheckboxField
      :model-value="form.secureMode"
      :label="t('networks.field.secureMode')"
      :help="t('networks.field.secureModeHint')"
      @update:model-value="set('secureMode', $event)"
    />
  </fieldset>
</template>
