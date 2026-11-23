<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { captchaUrl, register } from '../api/client'
import { useToast } from '../composables/useToast'
import UiButton from '../components/ui/UiButton.vue'
import UiInput from '../components/ui/UiInput.vue'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()

const username = ref('')
const password = ref('')
const captcha = ref('')
const error = ref('')
const loading = ref(false)
const captchaSrc = ref(`${captchaUrl()}?t=${Date.now()}`)

function refreshCaptcha() {
  captchaSrc.value = `${captchaUrl()}?t=${Date.now()}`
}

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await register(username.value, password.value, captcha.value)
    toast.success(t('auth.registerSuccess'))
    await router.replace({ name: 'login' })
  } catch (e) {
    error.value = t('auth.registerFailed', { message: e instanceof Error ? e.message : String(e) })
    captcha.value = ''
    refreshCaptcha()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-canvas px-4">
    <div class="w-full max-w-sm rounded-card border border-hairline bg-surface-card p-8">
      <p class="mb-6 flex items-center gap-2 text-[17px] font-medium text-ink">
        <span class="text-primary" aria-hidden="true">◆</span>EasyTier
      </p>
      <h2 class="mb-6 text-ink">{{ t('auth.register') }}</h2>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UiInput v-model="username" :label="t('auth.username')" autocomplete="username" />
        <UiInput v-model="password" type="password" :label="t('auth.password')" autocomplete="new-password" />
        <UiInput v-model="captcha" :label="t('auth.captcha')" autocomplete="off" />
        <button
          type="button"
          class="w-fit cursor-pointer rounded-control border border-hairline bg-canvas-soft p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          :title="t('auth.captchaRefresh')"
          :aria-label="t('auth.captchaRefresh')"
          @click="refreshCaptcha"
        >
          <img :src="captchaSrc" alt="" class="h-10 min-w-24" />
        </button>
        <p v-if="error" role="alert" class="text-[13px] text-error">{{ error }}</p>
        <UiButton variant="primary" type="submit" :loading="loading">{{ t('auth.register') }}</UiButton>
        <UiButton variant="secondary" @click="router.replace({ name: 'login' })">{{ t('auth.backToLogin') }}</UiButton>
      </form>
    </div>
  </div>
</template>
