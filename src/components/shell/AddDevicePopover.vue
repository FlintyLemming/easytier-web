<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSession } from '../../stores/session'
import { enrollCommand } from '../../lib/enroll'
import UiButton from '../ui/UiButton.vue'
import UiPopover from '../ui/UiPopover.vue'
import CopyButton from '../ui/CopyButton.vue'

const { t } = useI18n()
const session = useSession()
const command = computed(() => (session.info ? enrollCommand(session.info) : ''))
</script>

<template>
  <UiPopover>
    <template #trigger>
      <UiButton variant="primary" size="sm">{{ t('shell.addDevice') }}</UiButton>
    </template>
    <div class="flex w-[520px] max-w-[calc(100vw-48px)] flex-col gap-3">
      <p class="text-[14px] font-medium text-ink">{{ t('shell.addDevice') }}</p>
      <p class="text-[13px] text-muted">{{ t('shell.enrollHint') }}</p>
      <p v-if="!command" class="text-[13px] text-muted">{{ t('shell.enrollLoading') }}</p>
      <div v-else class="flex items-start gap-2 rounded-control border border-hairline bg-canvas-soft p-2">
        <code class="flex-1 text-[12px] text-ink [overflow-wrap:anywhere]">{{ command }}</code>
        <CopyButton :text="command" :label="t('shell.enrollCopy')" />
      </div>
      <p class="text-[12px] text-muted">
        {{ session.info?.webhook_auth ? t('shell.enrollWebhookNote') : t('shell.enrollTokenNote') }}
      </p>
    </div>
  </UiPopover>
</template>
