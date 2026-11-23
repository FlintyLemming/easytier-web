<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AddDevicePopover from './AddDevicePopover.vue'
import BlockedBell from './BlockedBell.vue'
import UserMenu from './UserMenu.vue'

const { t } = useI18n()
const route = useRoute()

const tabs = computed(() => [
  { key: 'devices', label: t('nav.devices'), to: '/devices', active: route.path.startsWith('/devices') },
])
</script>

<template>
  <header class="sticky top-0 z-30 h-14 border-b border-hairline bg-canvas">
    <div class="mx-auto flex h-full max-w-[1200px] items-center gap-8 px-6">
      <RouterLink to="/" class="flex items-center gap-2 text-[17px] font-medium tracking-[-0.11px] text-ink">
        <span class="text-primary" aria-hidden="true">◆</span>EasyTier
      </RouterLink>
      <nav :aria-label="t('nav.label')" class="flex h-full items-stretch gap-6">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.key"
          :to="tab.to"
          :aria-current="tab.active ? 'page' : undefined"
          class="flex items-center border-b-2 text-[14px]"
          :class="tab.active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'"
        >
          {{ tab.label }}
        </RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-3">
        <AddDevicePopover />
        <BlockedBell />
        <UserMenu />
      </div>
    </div>
  </header>
</template>
