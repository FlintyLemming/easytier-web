<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
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

// Below 640px (spec §5.9) the tabs collapse into a menu button; logo, 添加设备, the bell and the
// avatar stay in the bar (they fit at 360px wide).
const menuOpen = ref(false)
const menuButton = ref<HTMLButtonElement | null>(null)
const header = ref<HTMLElement | null>(null)
const panelId = useId()

function closeMenu(returnFocus = false) {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (returnFocus) void nextTick(() => menuButton.value?.focus())
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  closeMenu(true)
}

function onPointerDown(e: PointerEvent) {
  if (header.value && !header.value.contains(e.target as Node)) closeMenu()
}

function listen(on: boolean) {
  if (on) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('pointerdown', onPointerDown)
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('pointerdown', onPointerDown)
  }
}

watch(menuOpen, (open) => listen(open))
watch(() => route.fullPath, () => closeMenu())
onBeforeUnmount(() => listen(false))
</script>

<template>
  <header ref="header" class="sticky top-0 z-30 h-14 border-b border-hairline bg-canvas">
    <div class="mx-auto flex h-full max-w-[1200px] items-center gap-3 px-4 sm:gap-8 sm:px-6">
      <button
        ref="menuButton"
        type="button"
        class="-ml-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-body hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:hidden"
        :aria-label="t('nav.menu')"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        :aria-controls="menuOpen ? panelId : undefined"
        @click="menuOpen = !menuOpen"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path v-if="menuOpen" d="M6 6l12 12M18 6 6 18" />
          <path v-else d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <RouterLink to="/" class="flex shrink-0 items-center gap-2 text-[17px] font-medium tracking-[-0.11px] text-ink">
        <span class="text-primary" aria-hidden="true">◆</span>EasyTier
      </RouterLink>
      <nav :aria-label="t('nav.label')" class="hidden h-full items-stretch gap-6 sm:flex">
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
      <div class="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <AddDevicePopover />
        <BlockedBell />
        <UserMenu />
      </div>
    </div>

    <div
      v-if="menuOpen"
      :id="panelId"
      data-testid="nav-panel"
      class="absolute inset-x-0 top-full border-b border-hairline bg-canvas sm:hidden"
    >
      <nav :aria-label="t('nav.label')" class="flex flex-col px-2 py-2">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.key"
          :to="tab.to"
          :aria-current="tab.active ? 'page' : undefined"
          class="rounded-control px-3 py-2.5 text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
          :class="tab.active ? 'bg-surface-strong text-ink' : 'text-body hover:bg-surface-strong hover:text-ink'"
          @click="closeMenu()"
        >
          {{ tab.label }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
