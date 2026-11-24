<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NetworkConfig } from '../../lib/networkConfig'
import UiInput from '../ui/UiInput.vue'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import ListField from './ListField.vue'
import NumberField from './NumberField.vue'
import { cidrRule, flagOn, networkLengthRule, requiredRule, setFlag, useInvalidText, virtualIpv4Rule } from './rules'

// Instance mode only: in a central network these fields belong to the network.
const props = defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()
const invalid = useInvalidText()

function setHostname(value: string) {
  if (value) props.draft.hostname = value
  else delete props.draft.hostname
}

// Blank leaves the field out, as a core reads back a static node without an address (or a prefix
// length, which then defaults to 24).
function setVirtualIpv4(value: string) {
  if (value) props.draft.virtual_ipv4 = value
  else delete props.draft.virtual_ipv4
}

function setNetworkLength(value: number | null | undefined) {
  if (value === null || value === undefined) delete props.draft.network_length
  else props.draft.network_length = value
}
</script>

<template>
  <EditorSection name="network" :title="t('config.section.network')">
    <div class="grid gap-4 sm:grid-cols-2">
      <UiInput
        :model-value="draft.network_name ?? ''"
        :label="t('config.field.networkName')"
        autocomplete="off"
        :error="invalid(requiredRule(draft.network_name))"
        @update:model-value="(v) => (draft.network_name = v)"
      />
      <UiInput
        :model-value="draft.network_secret ?? ''"
        :label="t('config.field.networkSecret')"
        autocomplete="off"
        mono
        @update:model-value="(v) => (draft.network_secret = v)"
      />
    </div>
    <ListField
      v-model="draft.peer_urls"
      :label="t('config.field.peerUrls')"
      placeholder="tcp://public.easytier.cn:11010"
      mono
      :validate="(v: string) => invalid(requiredRule(v))"
    />
    <CheckboxField :model-value="flagOn(draft, 'dhcp')" :label="t('config.field.dhcp')" @update:model-value="(v) => setFlag(draft, 'dhcp', v)" />
    <div v-if="!flagOn(draft, 'dhcp')" class="grid gap-4 sm:grid-cols-[1fr_140px]">
      <UiInput
        :model-value="draft.virtual_ipv4 ?? ''"
        :label="t('config.field.virtualIpv4')"
        placeholder="10.144.144.1"
        mono
        :error="invalid(virtualIpv4Rule(draft.virtual_ipv4))"
        @update:model-value="setVirtualIpv4"
      />
      <NumberField
        :model-value="draft.network_length"
        :label="t('config.field.networkLength')"
        placeholder="24"
        :min="1"
        :max="32"
        :error="invalid(networkLengthRule(draft.network_length))"
        @update:model-value="setNetworkLength"
      />
    </div>
    <UiInput :model-value="draft.hostname ?? ''" :label="t('config.field.hostname')" autocomplete="off" @update:model-value="setHostname" />
    <ListField
      v-model="draft.proxy_cidrs"
      :label="t('config.field.proxyCidrs')"
      placeholder="192.168.1.0/24"
      mono
      :validate="(v: string) => invalid(cidrRule(v))"
    />
  </EditorSection>
</template>
