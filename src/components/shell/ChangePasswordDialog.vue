<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { changePassword } from '../../api/client'
import { useToast } from '../../composables/useToast'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'

const { t } = useI18n()
const toast = useToast()
const open = defineModel<boolean>('open', { default: false })

const next = ref('')
const confirm = ref('')
const error = ref('')
const saving = ref(false)

watch(open, (v) => {
  if (v) { next.value = ''; confirm.value = ''; error.value = '' }
})

async function submit() {
  if (!next.value) { error.value = t('password.empty'); return }
  if (next.value !== confirm.value) { error.value = t('password.mismatch'); return }
  saving.value = true
  try {
    await changePassword(next.value)
    toast.success(t('password.changed'))
    open.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t('shell.changePassword')">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <UiInput v-model="next" type="password" autocomplete="new-password" :label="t('password.newPassword')" />
      <UiInput
        v-model="confirm"
        type="password"
        autocomplete="new-password"
        :label="t('password.confirmPassword')"
        :error="error"
      />
      <div class="mt-2 flex justify-end gap-2">
        <UiButton variant="secondary" @click="open = false">{{ t('common.cancel') }}</UiButton>
        <UiButton variant="primary" type="submit" :loading="saving">{{ t('common.save') }}</UiButton>
      </div>
    </form>
  </UiDialog>
</template>
