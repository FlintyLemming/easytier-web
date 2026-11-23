<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CentralNetworkMember } from '../../api/types'
import { isIpv4 } from '../../domain/cidr'
import UiButton from '../ui/UiButton.vue'
import LinkButton from './LinkButton.vue'
import { SETTING_INPUT_CLASS } from './settingInput'
import { patchMember } from './writes'

// A non-empty virtual_ipv4 means fixed, otherwise the backend allocates one.
const props = defineProps<{
  deviceId: string
  networkId: string
  member: CentralNetworkMember
  /** Some row of the card (this one included) is saving: actions are disabled. */
  busy: boolean
}>()
const emit = defineEmits<{ busy: [on: boolean] }>()
const { t } = useI18n()
const inputId = useId()

const saving = ref(false)
function setSaving(on: boolean) {
  saving.value = on
  emit('busy', on)
}

const fixed = computed(() => !!props.member.virtual_ipv4)
const currentIp = computed(() => {
  const m = props.member
  const raw = m.virtual_ipv4 || m.allocated_ipv4 || m.runtime_virtual_ipv4
  return raw ? raw.split('/')[0]! : null
})
const text = computed(() => {
  if (fixed.value) return t('detail.settings.ipFixed', { ip: currentIp.value ?? '' })
  return currentIp.value ? t('detail.settings.ipAuto', { ip: currentIp.value }) : t('detail.settings.ipAutoPending')
})
const editing = ref(false)
const draft = ref('')
const error = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)

async function edit() {
  draft.value = currentIp.value ?? ''
  error.value = null
  editing.value = true
  await nextTick()
  input.value?.focus()
}

async function save() {
  if (props.busy) return
  const v = draft.value.trim()
  if (!isIpv4(v)) {
    error.value = t('detail.settings.ipInvalid')
    return
  }
  if (fixed.value && v === props.member.virtual_ipv4) {
    editing.value = false
    return
  }
  setSaving(true)
  const ok = await patchMember(props.networkId, props.deviceId, { virtual_ipv4: v }, t('detail.settings.ipSaved'))
  setSaving(false)
  if (ok) editing.value = false
}

async function setAuto() {
  if (props.busy) return
  setSaving(true)
  await patchMember(props.networkId, props.deviceId, { virtual_ipv4: '' }, t('detail.settings.ipSaved'))
  setSaving(false)
}
</script>

<template>
  <li data-testid="setting-ip" class="py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[13px] text-ink">{{ t('detail.settings.ip') }}</div>
        <div v-if="!editing" class="mt-0.5 font-mono text-[12px] text-muted">{{ text }}</div>
      </div>
      <div v-if="!editing" class="flex shrink-0 gap-4 pt-0.5">
        <template v-if="fixed">
          <LinkButton :disabled="busy" @click="edit">{{ t('detail.settings.change') }}</LinkButton>
          <LinkButton :loading="saving" :disabled="busy" @click="setAuto">{{ t('detail.settings.setAuto') }}</LinkButton>
        </template>
        <LinkButton v-else :disabled="busy" @click="edit">{{ t('detail.settings.setFixed') }}</LinkButton>
      </div>
    </div>
    <form v-if="editing" class="mt-2 flex flex-col gap-1" @submit.prevent="save">
      <div class="flex flex-wrap gap-2">
        <label :for="inputId" class="sr-only">{{ t('detail.settings.ip') }}</label>
        <input
          :id="inputId"
          ref="input"
          v-model="draft"
          type="text"
          placeholder="10.144.144.9"
          :aria-invalid="error ? 'true' : undefined"
          :class="[SETTING_INPUT_CLASS, 'font-mono', error ? 'border-error' : 'border-hairline-strong']"
          @input="error = null"
          @keydown.esc.prevent="editing = false"
        />
        <UiButton type="submit" size="sm" :loading="saving">{{ t('common.save') }}</UiButton>
        <UiButton variant="text" size="sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</UiButton>
      </div>
      <p v-if="error" class="text-[12px] text-error">{{ error }}</p>
    </form>
  </li>
</template>
