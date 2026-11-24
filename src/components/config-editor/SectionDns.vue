<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NetworkConfig } from '../../lib/networkConfig'
import UiInput from '../ui/UiInput.vue'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import { flagOn, setFlag } from './rules'

const props = defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()

// Only `dns.domain` is edited here; the rest of `dns` (zones, records) is left as it is, in place.
function setDomain(value: string) {
  const d = props.draft
  if (value) {
    if (d.dns) d.dns.domain = value
    else d.dns = { domain: value }
    return
  }
  if (!d.dns) return
  delete d.dns.domain
  if (Object.keys(d.dns).length === 0) delete d.dns
}
</script>

<template>
  <EditorSection name="dns" :title="t('config.section.dns')">
    <CheckboxField
      :model-value="flagOn(draft, 'enable_magic_dns')"
      :label="t('config.field.magicDns')"
      :help="t('config.flags.enable_magic_dns.help')"
      @update:model-value="(v) => setFlag(draft, 'enable_magic_dns', v)"
    />
    <UiInput
      :model-value="draft.dns?.domain ?? ''"
      class="sm:max-w-[320px]"
      :label="t('config.field.dnsDomain')"
      placeholder="et.net"
      mono
      @update:model-value="setDomain"
    />
  </EditorSection>
</template>
