<script setup lang="ts">
import { t } from '../../i18n'

defineProps<{ online: boolean }>()
</script>

<template>
  <span
    class="inline-block h-[7px] w-[7px] shrink-0 rounded-pill"
    :class="online ? 'bg-success' : 'bg-muted-soft'"
    role="img"
    :aria-label="online ? t('common.online') : t('common.offline')"
  />
</template>
