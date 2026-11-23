<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <div data-testid="webhook-banner" role="status" class="border-b border-hairline bg-canvas-soft text-[13px] text-body">
    <p class="mx-auto max-w-[1200px] px-6 py-2">{{ t('shell.webhookBanner') }}</p>
  </div>
</template>
