<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CentralNetworkDetail, GatewayInfo, NetworkCredential } from '../../api/types'
import { useToast } from '../../composables/useToast'
import { credentialJoinCommand, credentialJoinToml, joinPeer } from '../../domain/networks'
import { copyText } from '../../lib/clipboard'
import { LABEL_CLASS } from '../config-editor/styles'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'

/** How a device joins with a credential: CLI command or TOML snippet, plus the secret itself. */
const props = defineProps<{ credential: NetworkCredential | null; detail: CentralNetworkDetail | null; gateway: GatewayInfo | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const toast = useToast()

const format = ref<'cli' | 'toml'>('cli')
const revealed = ref(false)
watch(() => props.credential, () => {
  format.value = 'cli'
  revealed.value = false
})

const text = computed(() => {
  const c = props.credential
  const d = props.detail
  if (!c || !d) return ''
  return format.value === 'cli'
    ? credentialJoinCommand(d, props.gateway, c.credential_secret)
    : credentialJoinToml(d, props.gateway, c.credential_secret)
})
const noPeer = computed(() => !!props.detail && !joinPeer(props.detail, props.gateway))
const formatLabel = computed(() => (format.value === 'cli' ? t('credentials.joinCli') : t('credentials.joinToml')))

async function copy(value: string) {
  if (await copyText(value)) toast.success(t('credentials.copied'))
  else toast.error(t('common.copyFailed'))
}
</script>

<template>
  <UiDialog
    :open="!!credential"
    size="wide"
    :title="t('credentials.joinTitle', { id: credential?.credential_id ?? '' })"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <div v-if="credential" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" :aria-label="t('credentials.joinFormat')" class="inline-flex gap-0.5 rounded-control border border-hairline-strong p-0.5">
          <button
            v-for="f in (['cli', 'toml'] as const)"
            :key="f"
            type="button"
            role="radio"
            :aria-checked="format === f ? 'true' : 'false'"
            class="h-8 cursor-pointer rounded-[6px] px-3 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            :class="format === f ? 'bg-surface-strong text-ink' : 'text-muted hover:text-ink'"
            @click="format = f"
          >
            {{ f === 'cli' ? t('credentials.joinCli') : t('credentials.joinToml') }}
          </button>
        </div>
        <UiButton size="sm" :aria-label="t('common.copyItem', { label: formatLabel })" @click="copy(text)">{{ t('common.copy') }}</UiButton>
      </div>
      <textarea
        readonly
        spellcheck="false"
        :aria-label="formatLabel"
        :rows="format === 'cli' ? 3 : 9"
        :value="text"
        class="w-full resize-none rounded-control border border-hairline-strong bg-canvas-soft p-3 font-mono text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />
      <p v-if="noPeer" class="text-[12px] text-muted">{{ t('credentials.noPeer') }}</p>
      <div class="flex flex-col gap-1.5">
        <span :class="LABEL_CLASS">{{ t('credentials.secret') }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="min-w-0 break-all font-mono text-[13px] text-ink">{{ revealed ? credential.credential_secret : '••••••••••••' }}</span>
          <UiButton size="sm" variant="text" @click="revealed = !revealed">{{ revealed ? t('credentials.hide') : t('credentials.show') }}</UiButton>
          <UiButton size="sm" variant="text" :aria-label="t('common.copyItem', { label: t('credentials.secret') })" @click="copy(credential.credential_secret)">{{ t('common.copy') }}</UiButton>
        </div>
      </div>
    </div>
  </UiDialog>
</template>
