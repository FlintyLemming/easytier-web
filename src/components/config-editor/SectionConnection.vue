<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NetworkConfig } from '../../lib/networkConfig'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import ListField from './ListField.vue'
import NumberField from './NumberField.vue'
import { flagOn, listenerRule, mtuRule, setFlag, useInvalidText } from './rules'

defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()
const invalid = useInvalidText()
</script>

<template>
  <EditorSection name="connection" :title="t('config.section.connection')">
    <ListField
      v-model="draft.listener_urls"
      :label="t('config.field.listenerUrls')"
      placeholder="tcp://0.0.0.0:11010"
      mono
      :validate="(v: string) => invalid(listenerRule(v))"
    />
    <NumberField
      :model-value="draft.mtu"
      class="sm:max-w-[200px]"
      :label="t('config.field.mtu')"
      placeholder="1380"
      :min="400"
      :max="1380"
      :hint="t('config.field.mtuHint')"
      :error="invalid(mtuRule(draft.mtu))"
      @update:model-value="(v) => (draft.mtu = v ?? null)"
    />
    <CheckboxField
      :model-value="flagOn(draft, 'latency_first')"
      :label="t('config.field.latencyFirst')"
      :help="t('config.flags.latency_first.help')"
      @update:model-value="(v) => setFlag(draft, 'latency_first', v)"
    />
  </EditorSection>
</template>
