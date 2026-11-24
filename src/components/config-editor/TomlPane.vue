<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { generateToml, parseToml } from '../../api/client'
import { splitLegacyVpn } from '../../domain/vpnPortal'
import { normalizeNetworkConfig, toBackendNetworkConfig, type NetworkConfig } from '../../lib/networkConfig'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import { cloneConfig } from './rules'

/** Leaving the pane yields a new draft, 'unchanged', or null when the TOML does not parse. */
type TomlLeave = NetworkConfig | 'unchanged' | null

const props = defineProps<{ config: NetworkConfig; mode: 'member' | 'instance' }>()
const emit = defineEmits<{ back: []; invalid: [on: boolean] }>()
const { t } = useI18n()

// The form is hidden while this pane shows, so the draft it was opened with stays current. web 2.7
// rejects the legacy VPN portal fields, so they stay out of the TOML and go back onto every parse.
const { rest, legacy } = splitLegacyVpn(cloneConfig(props.config))
const instanceId = props.config.instance_id
const hasLegacy = Object.keys(legacy).length > 0

const state = ref<'loading' | 'ready' | 'error'>('loading')
const generateError = ref('')
const text = ref('')
/** The text the draft currently matches; leaving with it unchanged parses nothing. */
let clean = ''
const parseError = ref<string | null>(null)
const parsing = ref(false)
let pending: Promise<TomlLeave> | null = null

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function generate() {
  try {
    const r = await generateToml(toBackendNetworkConfig(rest))
    if ('error' in r) throw new Error(r.error)
    text.value = clean = r.toml
    state.value = 'ready'
  } catch (e) {
    generateError.value = errorMessage(e)
    state.value = 'error'
  }
}
void generate()

function setError(message: string | null) {
  parseError.value = message
  emit('invalid', message !== null)
}

function onInput(e: Event) {
  text.value = (e.target as HTMLTextAreaElement).value
  if (parseError.value !== null) setError(null)
}

async function parse(): Promise<TomlLeave> {
  const sent = text.value
  parsing.value = true
  try {
    const r = await parseToml(sent)
    if ('error' in r) {
      setError(t('config.toml.parseError', { message: r.error }))
      return null
    }
    const next = normalizeNetworkConfig(r.config as unknown as NetworkConfig)
    if (props.mode === 'instance') next.instance_id = instanceId
    Object.assign(next, legacy)
    clean = sent
    setError(null)
    return next
  } catch (e) {
    setError(t('config.toml.parseError', { message: errorMessage(e) }))
    return null
  } finally {
    parsing.value = false
  }
}

/** Parses the TOML if it was edited; a second call while a parse is running waits for the same one. */
function leave(): Promise<TomlLeave> {
  if (state.value !== 'ready' || text.value === clean) return Promise.resolve('unchanged')
  pending ??= parse().finally(() => {
    pending = null
  })
  return pending
}

defineExpose({ leave })
</script>

<template>
  <div class="flex flex-col gap-3">
    <template v-if="mode === 'member'">
      <p class="text-[13px] text-muted">{{ t('config.toml.memberHint') }}</p>
      <!-- A member's save always carries its subnet proxies from their own row (R12). -->
      <p class="text-[13px] text-muted">{{ t('config.toml.memberProxyHint') }}</p>
    </template>
    <p v-if="hasLegacy" class="text-[13px] text-muted">{{ t('config.toml.legacyHint') }}</p>

    <div v-if="state === 'loading'" class="flex flex-col gap-3">
      <p class="text-[13px] text-muted">{{ t('config.toml.loading') }}</p>
      <SkeletonRows :rows="6" />
    </div>

    <div v-else-if="state === 'error'" class="flex flex-col items-start gap-3">
      <p class="text-[13px] break-words whitespace-pre-wrap text-error">{{ t('config.toml.generateError', { message: generateError }) }}</p>
      <UiButton size="sm" @click="emit('back')">{{ t('config.toml.backToForm') }}</UiButton>
    </div>

    <template v-else>
      <textarea
        :value="text"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        rows="18"
        :readonly="parsing"
        :aria-label="t('config.tabs.toml')"
        :aria-invalid="parseError ? 'true' : undefined"
        class="min-h-[240px] w-full resize-y rounded-control border bg-surface-card p-3 font-mono text-[13px] leading-[1.5] text-ink focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        :class="parseError ? 'border-error' : 'border-hairline-strong'"
        @input="onInput"
      />
      <p v-if="parseError" role="alert" class="font-mono text-[12px] break-words whitespace-pre-wrap text-error">{{ parseError }}</p>
    </template>
  </div>
</template>
