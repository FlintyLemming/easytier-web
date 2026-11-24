<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AclProtocol, AclRule } from '../../api/types'
import { blankRule, draftToRule, ruleErrors, ruleToDraft, type RuleDraft, type SelectorKey } from '../../domain/acl'
import CheckboxField from '../config-editor/CheckboxField.vue'
import { FIELD_CLASS, LABEL_CLASS, REMOVE_CLASS } from '../config-editor/styles'
import AddButton from '../config-editor/AddButton.vue'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'
import SelectorPicker from './SelectorPicker.vue'
import type { SelectorOption } from './aclLabels'

/** Edits one rule locally; `done` hands the finished rule back, nothing is sent. */
const props = defineProps<{
  /** The rule being edited; null adds a new one. */
  rule: AclRule | null
  sourceOptions: SelectorOption[]
  destinationOptions: SelectorOption[]
  selectorText: (key: SelectorKey) => string
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ done: [rule: AclRule] }>()
const { t } = useI18n()
const actionId = useId()

const PROTOCOLS: AclProtocol[] = ['tcp', 'udp', 'icmp', 'icmpv6', 'any']
const draft = ref<RuleDraft>(blankRule())
const touched = ref(false)

watch(open, (v) => {
  if (!v) return
  draft.value = props.rule ? ruleToDraft(props.rule) : blankRule()
  touched.value = false
})

const errors = computed(() => ruleErrors(draft.value))
const has = (e: string) => errors.value.includes(e as never)
const show = (e: string) => (touched.value || e.startsWith('ports') || e.startsWith('stateful')) && has(e)

/** Options plus whatever the rule already names that is not offered (e.g. a member no longer listed). */
function withExisting(options: SelectorOption[], keys: SelectorKey[]): SelectorOption[] {
  const known = new Set(options.map((o) => o.key))
  return [...options, ...keys.filter((k) => !known.has(k)).map((k) => ({ key: k, label: props.selectorText(k) }))]
}
const sourceChoices = computed(() => withExisting(props.sourceOptions, props.rule ? ruleToDraft(props.rule).sources : []))
const destinationChoices = computed(() =>
  withExisting(props.destinationOptions, props.rule ? ruleToDraft(props.rule).destinations : []),
)

const isIcmp = (p: AclProtocol) => p === 'icmp' || p === 'icmpv6'

function setProtocol(i: number, protocol: AclProtocol) {
  const row = draft.value.protocols[i]!
  row.protocol = protocol
  if (isIcmp(protocol)) row.ports = ''
  if (protocol !== 'tcp') row.stateful = false
}

function portError(i: number): string | undefined {
  if (!has(`ports:${i}`)) return undefined
  return isIcmp(draft.value.protocols[i]!.protocol) ? t('acl.invalid.icmpPorts') : t('acl.invalid.ports')
}

function submit() {
  touched.value = true
  if (errors.value.length) return
  emit('done', draftToRule(draft.value, props.rule ?? undefined))
  open.value = false
}
</script>

<template>
  <UiDialog v-model:open="open" size="lg" :title="rule ? t('acl.editTitle') : t('acl.addTitle')">
    <form id="acl-rule" class="flex flex-col gap-4" @submit.prevent="submit">
      <UiInput v-model="draft.name" :label="t('acl.name')" :error="show('name') ? t('acl.invalid.name') : undefined" />
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div role="radiogroup" :aria-labelledby="actionId" class="flex items-center gap-4">
          <span :id="actionId" :class="LABEL_CLASS">{{ t('acl.action') }}</span>
          <label v-for="a in (['allow', 'deny'] as const)" :key="a" class="inline-flex cursor-pointer items-center gap-2 text-[14px] text-ink">
            <input v-model="draft.action" type="radio" :value="a" class="h-4 w-4 accent-ink" />{{ t(`acl.${a}`) }}
          </label>
        </div>
        <CheckboxField v-model="draft.enabled" :label="t('acl.enabled')" />
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <SelectorPicker
          v-model="draft.sources"
          :label="t('acl.sources')"
          :options="sourceChoices"
          :error="show('sources') ? t('acl.invalid.sources') : undefined"
        />
        <SelectorPicker
          v-model="draft.destinations"
          :label="t('acl.destinations')"
          :options="destinationChoices"
          :error="show('destinations') ? t('acl.invalid.destinations') : undefined"
        />
      </div>

      <div role="group" :aria-label="t('acl.protocols')" class="flex flex-col gap-2">
        <span :class="LABEL_CLASS" aria-hidden="true">{{ t('acl.protocols') }}</span>
        <div v-for="(p, i) in draft.protocols" :key="i" class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <select
              :value="p.protocol"
              :aria-label="t('acl.protocolN', { n: i + 1 })"
              :class="[FIELD_CLASS, 'border-hairline-strong w-32']"
              @change="setProtocol(i, ($event.target as HTMLSelectElement).value as AclProtocol)"
            >
              <option v-for="proto in PROTOCOLS" :key="proto" :value="proto">{{ t(`acl.proto.${proto}`) }}</option>
            </select>
            <input
              v-if="!isIcmp(p.protocol)"
              v-model="p.ports"
              type="text"
              spellcheck="false"
              :aria-label="t('acl.portsN', { n: i + 1 })"
              :aria-invalid="portError(i) ? 'true' : undefined"
              :placeholder="t('acl.portsPlaceholder')"
              :class="[FIELD_CLASS, 'min-w-0 flex-1 font-mono', portError(i) ? 'border-error' : 'border-hairline-strong']"
            />
            <label v-if="p.protocol === 'tcp'" class="inline-flex cursor-pointer items-center gap-2 text-[14px] text-ink" :title="t('acl.statefulHint')">
              <input v-model="p.stateful" type="checkbox" class="h-4 w-4 accent-ink" />{{ t('acl.stateful') }}
            </label>
            <button type="button" :aria-label="t('acl.removeProtocol')" :class="REMOVE_CLASS" @click="draft.protocols.splice(i, 1)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <p v-if="portError(i)" class="text-[12px] text-error">{{ portError(i) }}</p>
          <p v-if="has(`stateful:${i}`)" class="text-[12px] text-error">{{ t('acl.invalid.stateful') }}</p>
        </div>
        <p v-if="show('protocols')" class="text-[12px] text-error">{{ t('acl.invalid.protocols') }}</p>
        <AddButton @click="draft.protocols.push({ protocol: 'tcp', ports: '', stateful: draft.action === 'allow' })">{{ t('acl.addProtocol') }}</AddButton>
      </div>
    </form>
    <template #footer>
      <UiButton @click="open = false">{{ t('common.cancel') }}</UiButton>
      <UiButton type="submit" form="acl-rule" :disabled="errors.length > 0">{{ t('acl.done') }}</UiButton>
    </template>
  </UiDialog>
</template>
