<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { generateCredential } from '../../api/client'
import type { NetworkCredential } from '../../api/types'
import { useToast } from '../../composables/useToast'
import { CREDENTIAL_TTLS } from '../../domain/networks'
import CheckboxField from '../config-editor/CheckboxField.vue'
import { FIELD_CLASS, LABEL_CLASS } from '../config-editor/styles'
import { errorMessage } from '../device-detail/writes'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'

const props = defineProps<{ networkId: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ generated: [credential: NetworkCredential] }>()
const { t } = useI18n()
const toast = useToast()
const ttlId = useId()

const ttlHours = ref(24)
const reusable = ref(true)
const customId = ref('')
const busy = ref(false)

watch(open, (v) => {
  if (!v) return
  ttlHours.value = 24
  reusable.value = true
  customId.value = ''
})

function setOpen(v: boolean) {
  if (!busy.value) open.value = v
}

async function submit() {
  if (busy.value) return
  busy.value = true
  try {
    const created = await generateCredential(props.networkId, {
      ttlSeconds: ttlHours.value * 3600,
      reusable: reusable.value,
      credentialId: customId.value,
    })
    toast.success(t('credentials.generated'))
    busy.value = false
    open.value = false
    emit('generated', created)
  } catch (e) {
    toast.error(t('credentials.generateFailed', { message: errorMessage(e) }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiDialog :open="open" :title="t('credentials.generateTitle')" @update:open="setOpen">
    <form id="generate-credential" class="flex flex-col gap-4" @submit.prevent="submit">
      <fieldset class="flex flex-col gap-4" :disabled="busy">
        <div class="flex flex-col gap-1.5">
          <label :for="ttlId" :class="LABEL_CLASS">{{ t('credentials.ttl') }}</label>
          <select :id="ttlId" v-model.number="ttlHours" :class="[FIELD_CLASS, 'border-hairline-strong']">
            <option v-for="o in CREDENTIAL_TTLS" :key="o.key" :value="o.hours">{{ t(`network.ttl.${o.key}`) }}</option>
          </select>
        </div>
        <CheckboxField v-model="reusable" :label="t('credentials.reusableLabel')" :help="t('credentials.reusableHint')" />
        <UiInput v-model="customId" mono :label="t('credentials.customId')" :placeholder="t('credentials.customIdHint')" />
      </fieldset>
    </form>
    <template #footer>
      <UiButton :disabled="busy" @click="setOpen(false)">{{ t('common.cancel') }}</UiButton>
      <UiButton type="submit" form="generate-credential" :loading="busy">{{ t('credentials.submit') }}</UiButton>
    </template>
  </UiDialog>
</template>
