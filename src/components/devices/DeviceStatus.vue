<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import { relativeTime } from '../../domain/format'
import StatusDot from '../ui/StatusDot.vue'

const props = defineProps<{ device: DeviceView; now: Date }>()
const { t, locale } = useI18n()
const text = computed(() => {
  if (props.device.online) return t('devices.online')
  if (!props.device.lastSeen) return '—'
  return relativeTime(props.device.lastSeen, props.now, locale.value === 'en' ? 'en' : 'zh-CN')
})
</script>

<template>
  <span class="inline-flex items-center gap-2 text-[13px]" :class="device.online ? 'text-ink' : 'text-muted'">
    <StatusDot :online="device.online" />
    {{ text }}
  </span>
</template>
