<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { unblockDevice } from '../../api/client'
import { useInventory } from '../../stores/inventory'
import { useToast } from '../../composables/useToast'
import UiButton from '../ui/UiButton.vue'
import UiPopover from '../ui/UiPopover.vue'

const { t } = useI18n()
const inventory = useInventory()
const toast = useToast()

const attempted = computed(() => inventory.blocked.filter((d) => d.attempt_count > 0).length)
const busy = ref<string | null>(null)

const fmtTime = (s?: string | null) => (s ?? '').replace('T', ' ').slice(0, 19)

async function unblock(id: string) {
  busy.value = id
  try {
    await unblockDevice(id)
    toast.success(t('shell.blocked.unblocked'))
    await inventory.refresh()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <UiPopover>
    <template #trigger>
      <button
        type="button"
        :aria-label="t('shell.blocked.title')"
        class="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-body hover:bg-surface-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span
          v-if="attempted > 0"
          class="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 text-[10px] font-semibold leading-none text-white"
        >{{ attempted }}</span>
      </button>
    </template>
    <div class="flex w-[360px] max-w-[calc(100vw-48px)] flex-col gap-2">
      <p class="text-[14px] font-medium text-ink">{{ t('shell.blocked.title') }}</p>
      <p v-if="inventory.blocked.length === 0" class="py-2 text-[13px] text-muted">{{ t('shell.blocked.empty') }}</p>
      <ul v-else class="flex flex-col divide-y divide-hairline">
        <li v-for="d in inventory.blocked" :key="d.id" class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <p class="truncate text-[14px] text-ink">{{ d.alias || d.hostname }}</p>
            <p class="font-mono text-[11px] text-muted">{{ d.id }}</p>
            <p class="text-[12px] text-muted">
              <template v-if="d.attempt_count > 0">
                {{ t('shell.blocked.attempted', { time: fmtTime(d.last_attempt_time), count: d.attempt_count }) }}
              </template>
              <template v-else>{{ t('shell.blocked.noAttempt') }}</template>
            </p>
          </div>
          <UiButton size="sm" :loading="busy === d.id" @click="unblock(d.id)">{{ t('shell.blocked.unblock') }}</UiButton>
        </li>
      </ul>
    </div>
  </UiPopover>
</template>
