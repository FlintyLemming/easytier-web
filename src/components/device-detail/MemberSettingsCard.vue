<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CentralNetworkMember } from '../../api/types'
import SectionCard from '../ui/SectionCard.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import AdvancedConfigRow from './AdvancedConfigRow.vue'
import HostnameOverrideRow from './HostnameOverrideRow.vue'
import MemberIpRow from './MemberIpRow.vue'
import ProxyCidrEditor from './ProxyCidrEditor.vue'

defineProps<{
  deviceId: string
  /** As the detail header shows it. */
  deviceName: string
  /** The device's `easytier_version`. */
  coreVersion: string
  networkId: string
  networkName: string
  virtualCidr: string | null
  online: boolean
  member: CentralNetworkMember | null
  /** The inventory has loaded at least once (a missing member then means "not readable"). */
  loaded: boolean
}>()
const { t } = useI18n()

/** One row writes at a time; the others are disabled meanwhile. */
type Row = 'ip' | 'proxy' | 'hostname' | 'advanced'
const busy = ref<Row | null>(null)
function setBusy(row: Row, on: boolean) {
  if (on) busy.value = row
  else if (busy.value === row) busy.value = null
}
</script>

<template>
  <SectionCard data-testid="settings-card" :title="t('detail.settings.title')" :meta="networkName">
    <SkeletonRows v-if="!member && !loaded" :rows="4" />
    <p v-else-if="!member" class="text-[14px] text-muted">{{ t('detail.settings.memberMissing') }}</p>
    <ul v-else class="-my-3 flex flex-col divide-y divide-hairline-soft">
      <MemberIpRow
        :device-id="deviceId"
        :network-id="networkId"
        :member="member"
        :busy="busy !== null"
        @busy="(on) => setBusy('ip', on)"
      />
      <ProxyCidrEditor
        :device-id="deviceId"
        :network-id="networkId"
        :online="online"
        :cidrs="member.proxy_cidrs ?? []"
        :virtual-cidr="virtualCidr"
        :busy="busy !== null"
        @busy="(on) => setBusy('proxy', on)"
      />
      <HostnameOverrideRow
        :device-id="deviceId"
        :network-id="networkId"
        :member="member"
        :busy="busy !== null"
        @busy="(on) => setBusy('hostname', on)"
      />
      <AdvancedConfigRow
        :device-id="deviceId"
        :network-id="networkId"
        :device-name="deviceName"
        :core-version="coreVersion"
        :member="member"
        :busy="busy !== null"
        @busy="(on) => setBusy('advanced', on)"
      />
    </ul>
  </SectionCard>
</template>
