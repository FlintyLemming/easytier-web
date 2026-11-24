<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { deleteNetwork, updateNetwork } from '../../api/client'
import type { CentralNetworkDetail, NetworkingMethod } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { randomNetworkSecret, settingsErrors, settingsFormFrom, settingsImpacts, settingsPayload, type SettingsForm } from '../../domain/networks'
import { errorMessage, refreshInventoryFresh } from '../device-detail/writes'
import CopyButton from '../ui/CopyButton.vue'
import SectionCard from '../ui/SectionCard.vue'
import UiButton from '../ui/UiButton.vue'
import NetworkSettingsFields from './NetworkSettingsFields.vue'
import { networkDetailKey } from './context'

const props = defineProps<{ networkId: string }>()
const { t, locale } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const router = useRouter()
const ctx = inject(networkDetailKey)!

const baseline = ref<SettingsForm | null>(null)
const form = ref<SettingsForm | null>(null)
const busy = ref(false)
const revealed = ref(false)

const same = (a: SettingsForm | null, b: SettingsForm | null) => JSON.stringify(a) === JSON.stringify(b)
const changed = computed(() => !!form.value && !same(form.value, baseline.value))

// A refreshed detail re-fills the form only while it holds no edits.
watch(
  ctx.detail,
  (d) => {
    if (!d) return
    const next = settingsFormFrom(d)
    if (!changed.value) form.value = structuredClone(next)
    baseline.value = next
  },
  { immediate: true },
)

const errors = computed(() => (form.value ? settingsErrors(form.value) : {}))
const invalid = computed(() => Object.keys(errors.value).length > 0)
const currentMethod = computed(() => ctx.detail.value?.networking_method as NetworkingMethod | undefined)

async function save() {
  const d = ctx.detail.value
  if (!form.value || !d || busy.value || invalid.value || !changed.value) return
  const impacts = settingsImpacts(form.value, d)
  if (impacts.length) {
    const name = form.value.networkName.trim()
    const lines = impacts.map((k) => t(`settings.impact.${k}`, { name }))
    const ok = await confirm({ title: t('settings.confirmTitle'), body: lines.join(locale.value === 'en' ? '. ' : '；') + (locale.value === 'en' ? '.' : '。') })
    if (!ok) return
  }
  busy.value = true
  try {
    await updateNetwork(props.networkId, settingsPayload(form.value, d))
    toast.success(t('settings.saved'))
    await reloadAfterWrite()
    if (ctx.detail.value) form.value = settingsFormFrom(ctx.detail.value)
  } catch (e) {
    toast.error(t('settings.saveFailed', { message: errorMessage(e) }))
  } finally {
    busy.value = false
  }
}

async function reloadAfterWrite() {
  try {
    await ctx.reload()
  } catch {
    /* the next visit reads it again; the write itself succeeded */
  }
  await refreshInventoryFresh()
}

async function regenerate() {
  const d = ctx.detail.value
  if (!d || busy.value) return
  const ok = await confirm({
    title: t('settings.regenerateTitle'),
    body: t('settings.regenerateBody'),
    confirmLabel: t('settings.regenerateConfirm'),
    danger: true,
  })
  if (!ok) return
  busy.value = true
  try {
    // Built from the stored detail, so edits not yet saved in the form are not sent along.
    await updateNetwork(props.networkId, settingsPayload(settingsFormFrom(d), d), randomNetworkSecret())
    toast.success(t('settings.regenerated'))
    await reloadAfterWrite()
  } catch (e) {
    toast.error(t('settings.failed', { message: errorMessage(e) }))
  } finally {
    busy.value = false
  }
}

async function remove() {
  const d: CentralNetworkDetail | null = ctx.detail.value
  if (!d || busy.value) return
  const ok = await confirm({
    title: t('settings.deleteTitle'),
    body: t('settings.deleteBody', { name: d.display_name, n: d.member_count }),
    confirmLabel: t('settings.deleteConfirm'),
    danger: true,
  })
  if (!ok) return
  busy.value = true
  try {
    await deleteNetwork(props.networkId)
    toast.success(t('settings.deleted', { name: d.display_name }))
    await refreshInventoryFresh()
    await router.push({ name: 'networks', query: { list: '1' } })
  } catch (e) {
    toast.error(t('settings.deleteFailed', { message: errorMessage(e) }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="form && ctx.detail.value" class="flex max-w-2xl flex-col gap-6">
    <form class="flex flex-col gap-4" @submit.prevent="save">
      <NetworkSettingsFields
        v-model="form"
        :gateway-enabled="ctx.gateway.value?.enabled === true"
        :errors="errors"
        show-errors
        :current-method="currentMethod"
        :network-name-hint="t('settings.networkNameHint')"
        :disabled="busy"
      />
      <UiButton type="submit" class="self-start" :loading="busy" :disabled="!changed || invalid">{{ t('settings.save') }}</UiButton>
    </form>

    <div data-testid="network-secret">
      <SectionCard :title="t('settings.secretTitle')">
        <div class="flex flex-wrap items-center gap-2">
          <span class="min-w-0 break-all font-mono text-[13px] text-ink">{{ revealed ? ctx.detail.value.network_secret : '••••••••••••' }}</span>
          <UiButton size="sm" variant="text" @click="revealed = !revealed">{{ revealed ? t('settings.hide') : t('settings.show') }}</UiButton>
          <CopyButton :text="ctx.detail.value.network_secret" :label="t('common.copyItem', { label: t('settings.secretTitle') })" />
          <UiButton size="sm" class="ml-auto" :disabled="busy" @click="regenerate">{{ t('settings.regenerate') }}</UiButton>
        </div>
      </SectionCard>
    </div>

    <SectionCard :title="t('settings.danger')">
      <UiButton variant="danger" :disabled="busy" @click="remove">{{ t('settings.delete') }}</UiButton>
    </SectionCard>
  </div>
</template>
