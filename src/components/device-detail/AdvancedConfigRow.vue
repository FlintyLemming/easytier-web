<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clearMemberConfig, getMemberConfig, setMemberConfig } from '../../api/client'
import { ApiError } from '../../api/http'
import type { CentralNetworkMember } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { overrideState, resetOverridePlan } from '../../domain/memberOverride'
import LinkButton from './LinkButton.vue'
import { errorMessage, refreshInventoryFresh } from './writes'

// has_override only says an override object exists (PATCHing proxy_cidrs creates one), so read the
// object and compare it against the default (spec §6.5). The editor arrives with Plan 4.
const props = defineProps<{
  deviceId: string
  networkId: string
  member: CentralNetworkMember
  /** Some row of the card (this one included) is saving: actions are disabled. */
  busy: boolean
}>()
const emit = defineEmits<{ busy: [on: boolean] }>()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()

const config = ref<Record<string, unknown> | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const loadError = ref('')
const restoring = ref(false)
let seq = 0

async function load() {
  const seqNow = ++seq
  if (props.member.has_override === false) {
    config.value = null
    state.value = 'ready'
    return
  }
  state.value = 'loading'
  try {
    const c = await getMemberConfig(props.networkId, props.deviceId)
    if (seqNow !== seq) return
    config.value = c && typeof c === 'object' ? c : null
    state.value = 'ready'
  } catch (e) {
    if (seqNow !== seq) return
    if (e instanceof ApiError && e.status === 404) {
      config.value = null
      state.value = 'ready'
      return
    }
    loadError.value = errorMessage(e)
    state.value = 'error'
  }
}

// The inventory hands out new member objects every poll; only refetch when the override can have changed.
watch(
  () => `${props.member.has_override}|${(props.member.proxy_cidrs ?? []).join(',')}`,
  () => void load(),
  { immediate: true },
)

const overridden = computed(() => state.value === 'ready' && overrideState(config.value) === 'overridden')
const text = computed(() => {
  if (state.value === 'loading') return t('detail.settings.advancedLoading')
  if (state.value === 'error') return t('detail.settings.advancedError', { message: loadError.value })
  return overridden.value ? t('detail.settings.advancedOverridden') : t('detail.settings.advancedDefault')
})

async function restoreDefault() {
  if (props.busy) return
  // Capture the target before awaiting the dialog; the route can change while it is open.
  const networkId = props.networkId
  const deviceId = props.deviceId
  const plan = resetOverridePlan(config.value)
  const ok = await confirm({
    title: t('detail.settings.restoreTitle'),
    body: plan.kind === 'put' ? t('detail.settings.restoreBodyKeep') : t('detail.settings.restoreBody'),
    confirmLabel: t('detail.settings.restore'),
    danger: true,
  })
  if (!ok) return
  restoring.value = true
  emit('busy', true)
  try {
    if (plan.kind === 'put') await setMemberConfig(networkId, deviceId, plan.config)
    else await clearMemberConfig(networkId, deviceId)
    toast.success(t('detail.settings.restored'))
    await refreshInventoryFresh()
    await load()
  } catch (e) {
    toast.error(t('detail.settings.saveFailed', { message: errorMessage(e) }))
  } finally {
    restoring.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <li data-testid="setting-advanced" class="py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[13px] text-ink">{{ t('detail.settings.advanced') }}</div>
        <div data-testid="advanced-state" class="mt-0.5 text-[12px]" :class="state === 'error' ? 'text-error' : 'text-muted'">{{ text }}</div>
      </div>
      <LinkButton v-if="state === 'ready' && config !== null" :loading="restoring" :disabled="busy" @click="restoreDefault">
        {{ t('detail.settings.restore') }}
      </LinkButton>
    </div>
  </li>
</template>
