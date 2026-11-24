<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formFlags, type NetworkConfig } from '../../lib/networkConfig'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import { flagOn, SECTION_FLAGS, setFlag } from './rules'

defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()

// A help text that only repeats the label (or the field name) says nothing, so it is left out.
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
function help(field: string): string | undefined {
  const text = t(`config.flags.${field}.help`)
  return same(text, field) || same(text, t(`config.flags.${field}.label`)) ? undefined : text
}

const fields = formFlags()
  .map((f) => f.field as string)
  .filter((f) => !SECTION_FLAGS.has(f))
</script>

<template>
  <EditorSection name="flags" :title="t('config.section.flags')">
    <div class="grid gap-4 sm:grid-cols-2">
      <CheckboxField
        v-for="field in fields"
        :key="field"
        :model-value="flagOn(draft, field)"
        :label="t(`config.flags.${field}.label`)"
        :help="help(field)"
        @update:model-value="(v) => setFlag(draft, field, v)"
      />
    </div>
  </EditorSection>
</template>
