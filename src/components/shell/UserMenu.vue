<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { logout } from '../../api/client'
import { setLocale } from '../../i18n'
import { useSession } from '../../stores/session'
import UiMenu, { type UiMenuItem } from '../ui/UiMenu.vue'
import ChangePasswordDialog from './ChangePasswordDialog.vue'

const { t, locale } = useI18n()
const router = useRouter()
const session = useSession()
const passwordOpen = ref(false)

async function signOut() {
  try {
    await logout()
  } finally {
    session.reset()
    await router.replace({ name: 'login' })
  }
}

const items = computed<UiMenuItem[]>(() => [
  { label: session.username, disabled: true },
  { label: '', separator: true },
  { label: '简体中文', hint: locale.value === 'zh-CN' ? '✓' : undefined, onSelect: () => setLocale('zh-CN') },
  { label: 'English', hint: locale.value === 'en' ? '✓' : undefined, onSelect: () => setLocale('en') },
  { label: '', separator: true },
  { label: t('shell.changePassword'), onSelect: () => setTimeout(() => (passwordOpen.value = true), 0) },
  { label: t('shell.logout'), onSelect: () => void signOut() },
])
</script>

<template>
  <UiMenu :items="items">
    <template #trigger>
      <button
        type="button"
        :aria-label="t('shell.userMenu')"
        class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-pill bg-surface-strong text-[13px] font-medium uppercase text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >{{ session.username.slice(0, 1) || '?' }}</button>
    </template>
  </UiMenu>
  <ChangePasswordDialog v-model:open="passwordOpen" />
</template>
