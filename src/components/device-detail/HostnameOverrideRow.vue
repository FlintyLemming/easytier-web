<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CentralNetworkMember } from '../../api/types'
import UiButton from '../ui/UiButton.vue'
import LinkButton from './LinkButton.vue'
import { SETTING_INPUT_CLASS } from './settingInput'
import { patchMember } from './writes'

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
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

async function edit() {
  draft.value = props.member.hostname_override ?? ''
  editing.value = true
  await nextTick()
  input.value?.focus()
}

async function write(v: string) {
  if (props.busy) return
  if (v === (props.member.hostname_override ?? '')) {
    editing.value = false
    return
  }
  saving.value = true
  emit('busy', true)
  const ok = await patchMember(props.networkId, props.deviceId, { hostname_override: v }, t('detail.settings.hostnameSaved'))
  saving.value = false
  emit('busy', false)
  if (ok) editing.value = false
}
</script>

<template>
  <li data-testid="setting-hostname" class="py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[13px] text-ink">{{ t('detail.settings.hostname') }}</div>
        <div v-if="!editing" class="mt-0.5 text-[12px] break-all text-muted">
          {{ member.hostname_override || t('detail.settings.notSet') }}
        </div>
      </div>
      <div v-if="!editing" class="flex shrink-0 gap-4 pt-0.5">
        <LinkButton :disabled="busy" @click="edit">{{ t('detail.settings.edit') }}</LinkButton>
        <LinkButton v-if="member.hostname_override" :loading="saving" :disabled="busy" @click="write('')">
          {{ t('detail.settings.clear') }}
        </LinkButton>
      </div>
    </div>
    <form v-if="editing" class="mt-2 flex flex-col gap-1" @submit.prevent="write(draft.trim())">
      <div class="flex flex-wrap gap-2">
        <label :for="inputId" class="sr-only">{{ t('detail.settings.hostname') }}</label>
        <input
          :id="inputId"
          ref="input"
          v-model="draft"
          type="text"
          :placeholder="member.hostname ?? ''"
          :class="[SETTING_INPUT_CLASS, 'border-hairline-strong']"
          @keydown.esc.prevent="editing = false"
        />
        <UiButton type="submit" size="sm" :loading="saving">{{ t('common.save') }}</UiButton>
        <UiButton variant="text" size="sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</UiButton>
      </div>
      <p class="text-[12px] text-muted">{{ t('detail.settings.hostnameHint') }}</p>
    </form>
  </li>
</template>
