<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NetworkConfig } from '../../lib/networkConfig'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import { flagOn, PROXY_FLAGS, setFlag } from './rules'

defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()
</script>

<template>
  <EditorSection name="proxy" :title="t('config.section.proxy')">
    <div class="grid gap-4 sm:grid-cols-2">
      <CheckboxField
        v-for="field in PROXY_FLAGS"
        :key="field"
        :model-value="flagOn(draft, field)"
        :label="t(`config.flags.${field}.label`)"
        :help="t(`config.flags.${field}.help`)"
        @update:model-value="(v) => setFlag(draft, field, v)"
      />
    </div>
  </EditorSection>
</template>
