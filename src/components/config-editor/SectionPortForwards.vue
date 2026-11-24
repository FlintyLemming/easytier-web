<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NetworkConfig, PortForwardConfig } from '../../lib/networkConfig'
import UiInput from '../ui/UiInput.vue'
import AddButton from './AddButton.vue'
import EditorSection from './EditorSection.vue'
import NumberField from './NumberField.vue'
import { ipv4Rule, portRule, useInvalidText } from './rules'
import { FIELD_CLASS, LABEL_CLASS, REMOVE_CLASS } from './styles'

const props = defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()
const invalid = useInvalidText()
const protoId = useId()

// A blank port is NaN: invalid, and shown blank, until the user types one.
function add() {
  props.draft.port_forwards.push({ proto: 'tcp', bind_ip: '0.0.0.0', bind_port: NaN, dst_ip: '', dst_port: NaN })
}

function remove(i: number) {
  props.draft.port_forwards.splice(i, 1)
}

function setPort(row: PortForwardConfig, key: 'bind_port' | 'dst_port', value: number | null | undefined) {
  row[key] = value ?? NaN
}
</script>

<template>
  <EditorSection name="portForwards" :title="t('config.section.portForwards')">
    <ul v-if="draft.port_forwards.length" class="flex flex-col gap-4">
      <li
        v-for="(row, i) in draft.port_forwards"
        :key="i"
        class="grid grid-cols-2 items-start gap-2 sm:grid-cols-[88px_1fr_104px_1fr_104px_auto]"
      >
        <div class="flex flex-col gap-1.5">
          <label :for="`${protoId}-${i}`" :class="LABEL_CLASS">{{ t('config.field.pfProto') }}</label>
          <select
            :id="`${protoId}-${i}`"
            :value="row.proto"
            :class="[FIELD_CLASS, 'cursor-pointer border-hairline-strong font-mono']"
            @change="row.proto = ($event.target as HTMLSelectElement).value"
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
            <option v-if="row.proto !== 'tcp' && row.proto !== 'udp'" :value="row.proto">{{ row.proto }}</option>
          </select>
        </div>
        <UiInput
          v-model="row.bind_ip"
          :label="t('config.field.pfBindIp')"
          placeholder="0.0.0.0"
          mono
          :error="invalid(ipv4Rule(row.bind_ip))"
        />
        <NumberField
          :model-value="row.bind_port"
          :label="t('config.field.pfBindPort')"
          :min="1"
          :max="65535"
          :error="invalid(portRule(row.bind_port))"
          @update:model-value="(v) => setPort(row, 'bind_port', v)"
        />
        <UiInput
          v-model="row.dst_ip"
          :label="t('config.field.pfDstIp')"
          placeholder="10.144.144.2"
          mono
          :error="invalid(ipv4Rule(row.dst_ip))"
        />
        <NumberField
          :model-value="row.dst_port"
          :label="t('config.field.pfDstPort')"
          :min="1"
          :max="65535"
          :error="invalid(portRule(row.dst_port))"
          @update:model-value="(v) => setPort(row, 'dst_port', v)"
        />
        <button type="button" :aria-label="t('config.remove')" :class="[REMOVE_CLASS, 'sm:mt-[22px]']" @click="remove(i)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </li>
    </ul>
    <AddButton @click="add">{{ t('config.add') }}</AddButton>
  </EditorSection>
</template>
