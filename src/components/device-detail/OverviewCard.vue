<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceView } from '../../domain/devices'
import { locationText, relativeTime } from '../../domain/format'
import KeyValueList, { type KeyValueItem } from '../ui/KeyValueList.vue'
import SectionCard from '../ui/SectionCard.vue'

const props = withDefaults(
  defineProps<{
    device: DeviceView
    ip: string | null
    networkName: string | null
    networkCidr: string | null
    now: Date
    /** False in webhook mode: there are no central networks, so the IP and network rows are omitted. */
    showNetwork?: boolean
  }>(),
  { showNetwork: true },
)
const { t, locale } = useI18n()

const items = computed<KeyValueItem[]>(() => {
  const d = props.device
  const network = props.networkName
    ? [props.networkName, props.networkCidr].filter(Boolean).join(' · ')
    : t('detail.overview.notJoined')
  const lastSeen = d.online
    ? t('detail.overview.online')
    : d.lastSeen
      ? relativeTime(d.lastSeen, props.now, locale.value === 'en' ? 'en' : 'zh-CN')
      : null
  const networkRows: KeyValueItem[] = props.showNetwork
    ? [
        { label: t('detail.overview.ip'), value: props.ip, mono: true, copy: true },
        { label: t('detail.overview.network'), value: network },
      ]
    : []
  return [
    ...networkRows,
    { label: t('detail.overview.hostname'), value: d.hostname || null },
    { label: t('detail.overview.os'), value: d.os || null },
    {
      label: t('detail.overview.publicIp'),
      value: [d.publicIp, locationText(d.location)].filter(Boolean).join(' · ') || null,
      mono: true,
    },
    { label: t('detail.overview.version'), value: d.version || null, mono: true },
    { label: t('detail.overview.id'), value: d.id, mono: true, copy: true },
    { label: t('detail.overview.lastSeen'), value: lastSeen },
  ]
})
</script>

<template>
  <SectionCard data-testid="overview-card" :title="t('detail.overview.title')">
    <KeyValueList :items="items" />
  </SectionCard>
</template>
