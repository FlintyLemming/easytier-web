<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <div data-testid="webhook-banner" role="status" class="border-b border-hairline bg-canvas-soft px-6 py-2 text-[13px] text-body">
    {{ t('shell.webhookBanner') }}
  </div>
</template>
