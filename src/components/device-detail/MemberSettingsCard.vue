<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clearMemberConfig, getMemberConfig, setMemberConfig } from '../../api/client'
import { ApiError } from '../../api/http'
import type { CentralNetworkMember } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { useInventory } from '../../stores/inventory'
import { isIpv4 } from '../../domain/cidr'
import { overrideState, resetOverridePlan } from '../../domain/memberOverride'
import SectionCard from '../ui/SectionCard.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import LinkButton from './LinkButton.vue'
import ProxyCidrEditor from './ProxyCidrEditor.vue'
import { errorMessage, patchMember, refreshInventoryFresh } from './writes'

const props = defineProps<{
  deviceId: string
  networkId: string
  networkName: string
  virtualCidr: string | null
  online: boolean
  member: CentralNetworkMember | null
}>()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const inventory = useInventory()
const ipInputId = useId()
const hostInputId = useId()

const busy = ref<'ip' | 'hostname' | 'restore' | null>(null)

// --- private IP: a non-empty virtual_ipv4 means fixed, otherwise the backend allocates one ---
const fixed = computed(() => !!props.member?.virtual_ipv4)
const currentIp = computed(() => {
  const m = props.member
  if (!m) return null
  const raw = m.virtual_ipv4 || m.allocated_ipv4 || m.runtime_virtual_ipv4
  return raw ? raw.split('/')[0]! : null
})
const ipText = computed(() => {
  if (fixed.value) return t('detail.settings.ipFixed', { ip: currentIp.value ?? '' })
  return currentIp.value ? t('detail.settings.ipAuto', { ip: currentIp.value }) : t('detail.settings.ipAutoPending')
})
const ipEditing = ref(false)
const ipDraft = ref('')
const ipError = ref<string | null>(null)
const ipInput = ref<HTMLInputElement | null>(null)

async function editIp() {
  ipDraft.value = currentIp.value ?? ''
  ipError.value = null
  ipEditing.value = true
  await nextTick()
  ipInput.value?.focus()
}

async function saveIp() {
  if (busy.value) return
  const v = ipDraft.value.trim()
  if (!isIpv4(v)) {
    ipError.value = t('detail.settings.ipInvalid')
    return
  }
  if (fixed.value && v === props.member?.virtual_ipv4) {
    ipEditing.value = false
    return
  }
  busy.value = 'ip'
  const ok = await patchMember(props.networkId, props.deviceId, { virtual_ipv4: v }, t('detail.settings.ipSaved'))
  busy.value = null
  if (ok) ipEditing.value = false
}

async function setAuto() {
  if (busy.value) return
  busy.value = 'ip'
  await patchMember(props.networkId, props.deviceId, { virtual_ipv4: '' }, t('detail.settings.ipSaved'))
  busy.value = null
}

// --- hostname override ---
const hostEditing = ref(false)
const hostDraft = ref('')
const hostInput = ref<HTMLInputElement | null>(null)

async function editHost() {
  hostDraft.value = props.member?.hostname_override ?? ''
  hostEditing.value = true
  await nextTick()
  hostInput.value?.focus()
}

async function writeHost(v: string) {
  if (busy.value) return
  if (v === (props.member?.hostname_override ?? '')) {
    hostEditing.value = false
    return
  }
  busy.value = 'hostname'
  const ok = await patchMember(props.networkId, props.deviceId, { hostname_override: v }, t('detail.settings.hostnameSaved'))
  busy.value = null
  if (ok) hostEditing.value = false
}

// --- advanced config: has_override only says an override object exists (PATCHing proxy_cidrs
// creates one), so read the object and compare it against the default. ---
const config = ref<Record<string, unknown> | null>(null)
const configState = ref<'loading' | 'ready' | 'error'>('loading')
const configError = ref('')
let configSeq = 0

async function loadConfig() {
  const m = props.member
  if (!m) return
  const seq = ++configSeq
  if (m.has_override === false) {
    config.value = null
    configState.value = 'ready'
    return
  }
  configState.value = 'loading'
  try {
    const c = await getMemberConfig(props.networkId, props.deviceId)
    if (seq !== configSeq) return
    config.value = c && typeof c === 'object' ? c : null
    configState.value = 'ready'
  } catch (e) {
    if (seq !== configSeq) return
    if (e instanceof ApiError && e.status === 404) {
      config.value = null
      configState.value = 'ready'
      return
    }
    configError.value = errorMessage(e)
    configState.value = 'error'
  }
}

// The inventory hands out new member objects every poll; only refetch when the override can have changed.
watch(
  () => (props.member ? `${props.member.has_override}|${(props.member.proxy_cidrs ?? []).join(',')}` : null),
  (key) => { if (key !== null) void loadConfig() },
  { immediate: true },
)

const advancedText = computed(() => {
  if (configState.value === 'loading') return t('detail.settings.advancedLoading')
  if (configState.value === 'error') return t('detail.settings.advancedError', { message: configError.value })
  return overrideState(config.value) === 'overridden'
    ? t('detail.settings.advancedOverridden')
    : t('detail.settings.advancedDefault')
})

async function restoreDefault() {
  if (busy.value) return
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
  busy.value = 'restore'
  try {
    if (plan.kind === 'put') await setMemberConfig(networkId, deviceId, plan.config)
    else await clearMemberConfig(networkId, deviceId)
    toast.success(t('detail.settings.restored'))
    await refreshInventoryFresh()
    await loadConfig()
  } catch (e) {
    toast.error(t('detail.settings.saveFailed', { message: errorMessage(e) }))
  } finally {
    busy.value = null
  }
}

const inputClass =
  'h-[30px] w-full max-w-[240px] min-w-0 rounded-control border bg-surface-card px-2.5 text-[13px] text-ink placeholder:text-muted-soft focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
</script>

<template>
  <SectionCard data-testid="settings-card" :title="t('detail.settings.title')" :meta="networkName">
    <SkeletonRows v-if="!member && !inventory.loaded" :rows="4" />
    <p v-else-if="!member" class="text-[14px] text-muted">{{ t('detail.settings.memberMissing') }}</p>
    <ul v-else class="-my-3 flex flex-col divide-y divide-hairline-soft">
      <!-- private IP -->
      <li data-testid="setting-ip" class="py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13px] text-ink">{{ t('detail.settings.ip') }}</div>
            <div v-if="!ipEditing" class="mt-0.5 font-mono text-[12px] text-muted">{{ ipText }}</div>
          </div>
          <div v-if="!ipEditing" class="flex shrink-0 gap-4 pt-0.5">
            <template v-if="fixed">
              <LinkButton :disabled="busy !== null" @click="editIp">{{ t('detail.settings.change') }}</LinkButton>
              <LinkButton :loading="busy === 'ip'" :disabled="busy !== null" @click="setAuto">{{ t('detail.settings.setAuto') }}</LinkButton>
            </template>
            <LinkButton v-else :disabled="busy !== null" @click="editIp">{{ t('detail.settings.setFixed') }}</LinkButton>
          </div>
        </div>
        <form v-if="ipEditing" class="mt-2 flex flex-col gap-1" @submit.prevent="saveIp">
          <div class="flex flex-wrap gap-2">
            <label :for="ipInputId" class="sr-only">{{ t('detail.settings.ip') }}</label>
            <input
              :id="ipInputId"
              ref="ipInput"
              v-model="ipDraft"
              type="text"
              placeholder="10.144.144.9"
              :aria-invalid="ipError ? 'true' : undefined"
              :class="[inputClass, 'font-mono', ipError ? 'border-error' : 'border-hairline-strong']"
              @input="ipError = null"
              @keydown.esc.prevent="ipEditing = false"
            />
            <UiButton type="submit" size="sm" :loading="busy === 'ip'">{{ t('common.save') }}</UiButton>
            <UiButton variant="text" size="sm" :disabled="busy === 'ip'" @click="ipEditing = false">{{ t('common.cancel') }}</UiButton>
          </div>
          <p v-if="ipError" class="text-[12px] text-error">{{ ipError }}</p>
        </form>
      </li>

      <!-- subnet proxy -->
      <ProxyCidrEditor
        :device-id="deviceId"
        :network-id="networkId"
        :online="online"
        :cidrs="member.proxy_cidrs ?? []"
        :virtual-cidr="virtualCidr"
      />

      <!-- hostname override -->
      <li data-testid="setting-hostname" class="py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13px] text-ink">{{ t('detail.settings.hostname') }}</div>
            <div v-if="!hostEditing" class="mt-0.5 text-[12px] break-all text-muted">
              {{ member.hostname_override || t('detail.settings.notSet') }}
            </div>
          </div>
          <div v-if="!hostEditing" class="flex shrink-0 gap-4 pt-0.5">
            <LinkButton :disabled="busy !== null" @click="editHost">{{ t('detail.settings.edit') }}</LinkButton>
            <LinkButton
              v-if="member.hostname_override"
              :loading="busy === 'hostname'"
              :disabled="busy !== null"
              @click="writeHost('')"
            >
              {{ t('detail.settings.clear') }}
            </LinkButton>
          </div>
        </div>
        <form v-if="hostEditing" class="mt-2 flex flex-col gap-1" @submit.prevent="writeHost(hostDraft.trim())">
          <div class="flex flex-wrap gap-2">
            <label :for="hostInputId" class="sr-only">{{ t('detail.settings.hostname') }}</label>
            <input
              :id="hostInputId"
              ref="hostInput"
              v-model="hostDraft"
              type="text"
              :placeholder="member.hostname ?? ''"
              :class="[inputClass, 'border-hairline-strong']"
              @keydown.esc.prevent="hostEditing = false"
            />
            <UiButton type="submit" size="sm" :loading="busy === 'hostname'">{{ t('common.save') }}</UiButton>
            <UiButton variant="text" size="sm" :disabled="busy === 'hostname'" @click="hostEditing = false">{{ t('common.cancel') }}</UiButton>
          </div>
          <p class="text-[12px] text-muted">{{ t('detail.settings.hostnameHint') }}</p>
        </form>
      </li>

      <!-- advanced config (the editor arrives with Plan 4) -->
      <li data-testid="setting-advanced" class="py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13px] text-ink">{{ t('detail.settings.advanced') }}</div>
            <div data-testid="advanced-state" class="mt-0.5 text-[12px]" :class="configState === 'error' ? 'text-error' : 'text-muted'">{{ advancedText }}</div>
          </div>
          <LinkButton
            v-if="configState === 'ready' && config !== null"
            :loading="busy === 'restore'"
            :disabled="busy !== null"
            @click="restoreDefault"
          >
            {{ t('detail.settings.restore') }}
          </LinkButton>
        </div>
      </li>
    </ul>
  </SectionCard>
</template>
