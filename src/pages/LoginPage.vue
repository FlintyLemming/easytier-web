<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getOidcConfig, login, oidcLoginUrl } from '../api/client'
import { ApiError } from '../api/http'
import { useSession } from '../stores/session'
import UiButton from '../components/ui/UiButton.vue'
import UiInput from '../components/ui/UiInput.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const session = useSession()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const oidc = ref(false)

/** Only same-app absolute paths; never `//host` or full URLs. */
function safeNext(): string {
  const n = route.query.next
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/'
}

onMounted(async () => {
  oidc.value = (await getOidcConfig()).enabled
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await login(username.value, password.value)
    await session.load()
    await router.replace(safeNext())
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401
        ? t('auth.invalidCredentials')
        : t('auth.loginFailed', { message: e instanceof Error ? e.message : String(e) })
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
      <h2 class="mb-6 text-ink">{{ t('auth.login') }}</h2>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UiInput v-model="username" :label="t('auth.username')" autocomplete="username" />
        <UiInput v-model="password" type="password" :label="t('auth.password')" autocomplete="current-password" />
        <p v-if="error" role="alert" class="text-[13px] text-error">{{ error }}</p>
        <UiButton variant="primary" type="submit" :loading="loading">{{ t('auth.login') }}</UiButton>
        <a
          v-if="oidc"
          :href="oidcLoginUrl()"
          class="inline-flex h-10 items-center justify-center rounded-control border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink"
        >{{ t('auth.ssoLogin') }}</a>
      </form>
      <p class="mt-6 text-[13px] text-muted">
        {{ t('auth.noAccount') }}
        <RouterLink :to="{ name: 'register' }" replace class="text-ink underline">{{ t('auth.register') }}</RouterLink>
      </p>
    </div>
  </div>
</template>
