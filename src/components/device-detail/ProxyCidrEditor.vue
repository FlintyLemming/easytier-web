<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nodeInfo } from '../../api/client'
import { candidateCidrs, isIpv4Cidr } from '../../domain/cidr'
import UiButton from '../ui/UiButton.vue'
import LinkButton from './LinkButton.vue'
import { errorMessage, patchMember } from './writes'

const props = defineProps<{
  deviceId: string
  networkId: string
  online: boolean
  cidrs: string[]
  virtualCidr: string | null
}>()
const { t } = useI18n()
const inputId = useId()

const editing = ref(false)
const saving = ref(false)
const draft = ref<string[]>([])
const input = ref('')
const inputError = ref<string | null>(null)

const interfaceIps = ref<string[] | null>(null)
const candidatesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const candidatesError = ref('')

const candidates = computed(() =>
  candidateCidrs(interfaceIps.value ?? [], { existing: draft.value, virtualCidr: props.virtualCidr }),
)
const changed = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.cidrs))

async function loadCandidates() {
  if (!props.online) return
  candidatesState.value = 'loading'
  try {
    interfaceIps.value = (await nodeInfo(props.deviceId, props.networkId)).interfaceIpv4s
    candidatesState.value = 'ready'
  } catch (e) {
    candidatesError.value = errorMessage(e)
    candidatesState.value = 'error'
  }
}

function start() {
  draft.value = [...props.cidrs]
  input.value = ''
  inputError.value = null
  editing.value = true
  if (props.online && candidatesState.value !== 'ready' && candidatesState.value !== 'loading') void loadCandidates()
}

// The device may come online while the editor is open.
watch(
  () => props.online,
  (v) => { if (v && editing.value && candidatesState.value !== 'ready' && candidatesState.value !== 'loading') void loadCandidates() },
)

function cancel() {
  editing.value = false
}

function add(cidr: string) {
  if (!draft.value.includes(cidr)) draft.value = [...draft.value, cidr]
}

function addTyped() {
  const v = input.value.trim()
  if (!isIpv4Cidr(v)) {
    inputError.value = t('detail.proxy.invalid')
    return
  }
  if (draft.value.includes(v)) {
    inputError.value = t('detail.proxy.duplicate')
    return
  }
  add(v)
  input.value = ''
  inputError.value = null
}

function remove(cidr: string) {
  draft.value = draft.value.filter((c) => c !== cidr)
}

async function save() {
  if (saving.value) return
  if (!changed.value) {
    editing.value = false
    return
  }
  saving.value = true
  const ok = await patchMember(props.networkId, props.deviceId, { proxy_cidrs: [...draft.value] }, t('detail.proxy.saved'))
  saving.value = false
  if (ok) editing.value = false
}
</script>

<template>
  <li data-testid="setting-proxy" class="py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[13px] text-ink">{{ t('detail.settings.proxy') }}</div>
        <div v-if="!editing" class="mt-0.5 text-[12px] text-muted">
          <span v-if="cidrs.length" class="font-mono break-all">{{ cidrs.join(', ') }}</span>
          <span v-else>{{ t('detail.settings.notSet') }}</span>
        </div>
      </div>
      <LinkButton v-if="!editing" class="mt-0.5 shrink-0" @click="start">{{ t('detail.settings.edit') }}</LinkButton>
    </div>

    <div v-if="editing" class="mt-3 flex flex-col gap-3">
      <ul v-if="draft.length" class="flex flex-wrap gap-2">
        <li
          v-for="c in draft"
          :key="c"
          class="inline-flex items-center gap-1 rounded-pill border border-hairline-strong bg-surface-card py-0.5 pr-1 pl-2.5 font-mono text-[12px] text-ink"
        >
          {{ c }}
          <button
            type="button"
            :aria-label="t('detail.proxy.remove', { cidr: c })"
            class="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-pill text-muted hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
            @click="remove(c)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </li>
      </ul>
      <p v-else class="text-[12px] text-muted">{{ t('detail.proxy.empty') }}</p>

      <div class="flex flex-col gap-1">
        <div class="flex gap-2">
          <label :for="inputId" class="sr-only">{{ t('detail.proxy.inputLabel') }}</label>
          <input
            :id="inputId"
            v-model="input"
            type="text"
            :placeholder="t('detail.proxy.placeholder')"
            :aria-invalid="inputError ? 'true' : undefined"
            class="h-[30px] w-full max-w-[240px] min-w-0 rounded-control border bg-surface-card px-2.5 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-muted-soft focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            :class="inputError ? 'border-error' : 'border-hairline-strong'"
            @keydown.enter.prevent="addTyped"
            @input="inputError = null"
          />
          <UiButton size="sm" @click="addTyped">{{ t('detail.proxy.add') }}</UiButton>
        </div>
        <p v-if="inputError" class="text-[12px] text-error">{{ inputError }}</p>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-[12px] text-muted">{{ t('detail.proxy.candidates') }}</span>
        <p v-if="!online" class="text-[12px] text-muted-soft">{{ t('detail.proxy.candidatesOffline') }}</p>
        <p v-else-if="candidatesState === 'loading'" class="text-[12px] text-muted-soft">{{ t('detail.proxy.candidatesLoading') }}</p>
        <p v-else-if="candidatesState === 'error'" class="text-[12px] text-muted-soft">
          {{ t('detail.proxy.candidatesFailed', { message: candidatesError }) }}
        </p>
        <p v-else-if="candidates.length === 0" class="text-[12px] text-muted-soft">{{ t('detail.proxy.candidatesNone') }}</p>
        <div v-else class="flex flex-wrap gap-2">
          <button
            v-for="c in candidates"
            :key="c"
            type="button"
            :aria-label="t('detail.proxy.candidateAdd', { cidr: c })"
            class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-pill border border-dashed border-hairline-strong px-2.5 font-mono text-[12px] text-body hover:border-ink hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click="add(c)"
          >
            <span aria-hidden="true">+</span>{{ c }}
          </button>
        </div>
      </div>

      <div class="flex gap-2">
        <UiButton size="sm" :loading="saving" :disabled="!changed" @click="save">{{ t('common.save') }}</UiButton>
        <UiButton size="sm" variant="text" :disabled="saving" @click="cancel">{{ t('common.cancel') }}</UiButton>
      </div>
    </div>
  </li>
</template>
