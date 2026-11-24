<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, toRaw, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usesLegacyVpn } from '../../domain/vpnPortal'
import type { NetworkConfig } from '../../lib/networkConfig'
import { cloneConfig, draftValid } from './rules'
import SectionConnection from './SectionConnection.vue'
import SectionCrypto from './SectionCrypto.vue'
import SectionDns from './SectionDns.vue'
import SectionFlags from './SectionFlags.vue'
import SectionNetwork from './SectionNetwork.vue'
import SectionPortForwards from './SectionPortForwards.vue'
import SectionProxy from './SectionProxy.vue'
import SectionVpnPortal from './SectionVpnPortal.vue'
import TomlPane from './TomlPane.vue'

// Edits a copy of a normalized config. The form only writes the fields it shows; everything else in
// the draft is carried through untouched.
const props = defineProps<{
  modelValue: NetworkConfig
  mode: 'member' | 'instance'
  /** The device's `easytier_version`: cores before 2.7 get the legacy VPN portal. */
  coreVersion: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: NetworkConfig]; 'update:valid': [valid: boolean] }>()
const { t } = useI18n()

const draft = ref<NetworkConfig>(cloneConfig(props.modelValue))
/** The config as read, never edited: switching a VPN portal back off returns to it. */
const opened = shallowRef<NetworkConfig>(cloneConfig(props.modelValue))
let emitted: NetworkConfig | null = null
// A parent handing back what was emitted (v-model) is not a new config to start over from.
watch(
  () => props.modelValue,
  (v) => {
    if (toRaw(v) === emitted) return
    draft.value = cloneConfig(v)
    opened.value = cloneConfig(v)
  },
)
watch(
  draft,
  (d) => {
    emitted = cloneConfig(d)
    emit('update:modelValue', emitted)
  },
  { deep: true },
)

const legacyVpn = computed(() => usesLegacyVpn(props.coreVersion, draft.value))
const formValid = computed(() => draftValid(draft.value, { mode: props.mode, legacyVpn: legacyVpn.value }))
const tomlInvalid = ref(false)
watch(
  () => formValid.value && !tomlInvalid.value,
  (v) => emit('update:valid', v),
  { immediate: true },
)

// --- tabs ---

type Tab = 'form' | 'toml'
const TABS: Tab[] = ['form', 'toml']
const tab = ref<Tab>('form')
const toml = ref<InstanceType<typeof TomlPane> | null>(null)
const switching = ref(false)
const baseId = useId()
const tabButtons = ref<HTMLButtonElement[]>([])

/** Applies an edited TOML to the draft. False when it does not parse (the pane shows why). */
async function applyToml(): Promise<boolean> {
  if (tab.value !== 'toml' || !toml.value) return true
  switching.value = true
  try {
    const next = await toml.value.leave()
    if (next === null) return false
    if (next !== 'unchanged') draft.value = next
    return true
  } finally {
    switching.value = false
  }
}

async function select(next: Tab) {
  if (next === tab.value || switching.value) return
  if (next === 'form' && !(await applyToml())) return
  tomlInvalid.value = false
  tab.value = next
}

async function onTabKey(e: KeyboardEvent) {
  const i = TABS.indexOf(tab.value)
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  await select(TABS[(i + step + TABS.length) % TABS.length]!)
  await nextTick()
  tabButtons.value[TABS.indexOf(tab.value)]?.focus()
}

/**
 * The draft to save: an edited TOML is parsed first. Null when the TOML does not parse or the draft
 * is invalid (the form is then shown, with its errors).
 */
async function flush(): Promise<NetworkConfig | null> {
  if (!(await applyToml())) return null
  if (!formValid.value) {
    tab.value = 'form'
    return null
  }
  return cloneConfig(draft.value)
}

defineExpose({ flush })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div role="tablist" :aria-label="t('config.tabs.label')" class="inline-flex gap-0.5 self-start rounded-control border border-hairline-strong p-0.5" @keydown="onTabKey">
      <button
        v-for="name in TABS"
        :id="`${baseId}-tab-${name}`"
        :key="name"
        ref="tabButtons"
        type="button"
        role="tab"
        :aria-selected="tab === name ? 'true' : 'false'"
        :aria-controls="`${baseId}-panel-${name}`"
        :tabindex="tab === name ? 0 : -1"
        :disabled="switching && tab !== name"
        class="h-8 cursor-pointer rounded-[6px] px-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink disabled:cursor-wait"
        :class="tab === name ? 'bg-surface-strong text-ink' : 'text-muted hover:text-ink'"
        @click="select(name)"
      >
        {{ t(`config.tabs.${name}`) }}
      </button>
    </div>

    <div
      v-if="tab === 'form'"
      :id="`${baseId}-panel-form`"
      role="tabpanel"
      :aria-labelledby="`${baseId}-tab-form`"
      class="flex flex-col divide-y divide-hairline-soft"
    >
      <SectionNetwork v-if="mode === 'instance'" :draft="draft" />
      <SectionConnection :draft="draft" />
      <SectionCrypto :draft="draft" />
      <SectionProxy :draft="draft" />
      <SectionPortForwards :draft="draft" />
      <SectionDns :draft="draft" />
      <SectionVpnPortal :draft="draft" :mode="mode" :core-version="coreVersion" :opened="opened" />
      <SectionFlags :draft="draft" />
    </div>

    <div v-else :id="`${baseId}-panel-toml`" role="tabpanel" :aria-labelledby="`${baseId}-tab-toml`">
      <TomlPane ref="toml" :config="draft" :mode="mode" @back="tab = 'form'" @invalid="tomlInvalid = $event" />
    </div>
  </div>
</template>
