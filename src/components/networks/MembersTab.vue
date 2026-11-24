<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAclPolicy, removeMember } from '../../api/client'
import { useConfirm } from '../../composables/useConfirm'
import { useNarrow } from '../../composables/useNarrow'
import { useToast } from '../../composables/useToast'
import { memberRows, type MemberRow } from '../../domain/networks'
import { useInventory } from '../../stores/inventory'
import { errorMessage, refreshInventoryFresh } from '../device-detail/writes'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import AddMembersDialog from './AddMembersDialog.vue'
import MemberRowView from './MemberRowView.vue'
import TemporaryPeersList from './TemporaryPeersList.vue'
import { networkDetailKey } from './context'

const props = defineProps<{ networkId: string }>()
const { t, locale } = useI18n()
const inventory = useInventory()
const toast = useToast()
const { confirm } = useConfirm()
const narrow = useNarrow(640)
const ctx = inject(networkDetailKey)!

const now = ref(new Date())
const tick = setInterval(() => { now.value = new Date() }, 30_000)
onBeforeUnmount(() => clearInterval(tick))

const loaded = computed(() => props.networkId in inventory.membersByNetwork)
const rows = computed(() => memberRows(inventory.membersByNetwork[props.networkId] ?? []))
const online = computed(() => rows.value.filter((r) => r.online).length)
const peers = computed(() => inventory.temporaryByNetwork[props.networkId] ?? [])
const osOf = (deviceId: string) => inventory.deviceById(deviceId)?.os ?? ''

const adding = ref(false)
const removing = ref(false)

/** Removing a member prunes the ACL rules that name it, so warn when there are rules. */
async function hasAclRules(): Promise<boolean> {
  try {
    return (await getAclPolicy(props.networkId)).rules.length > 0
  } catch {
    return true
  }
}

async function remove(row: MemberRow) {
  if (removing.value) return
  const network = ctx.detail.value?.display_name ?? ''
  let body = t('network.members.removeBody', { name: row.name, network })
  if (await hasAclRules()) body += (locale.value === 'en' ? ' ' : '') + t('network.members.removeAclNote')
  const ok = await confirm({
    title: t('network.members.removeTitle'),
    body,
    confirmLabel: t('network.members.removeConfirm'),
    danger: true,
  })
  if (!ok) return
  removing.value = true
  try {
    await removeMember(props.networkId, row.deviceId)
    toast.success(t('network.members.removed', { name: row.name }))
    await refreshInventoryFresh()
  } catch (e) {
    toast.error(t('network.members.removeFailed', { message: errorMessage(e) }))
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-[14px] text-muted">{{ loaded ? t('network.members.summary', { n: rows.length, m: online }) : '' }}</p>
      <UiButton variant="primary" @click="adding = true">{{ t('network.members.add') }}</UiButton>
    </div>

    <SkeletonRows v-if="!loaded" :rows="4" />
    <div v-else-if="rows.length === 0" class="rounded-card border border-hairline bg-surface-card">
      <EmptyState :title="t('network.members.empty')" />
    </div>
    <ul v-else-if="narrow" class="flex flex-col gap-3">
      <MemberRowView
        v-for="r in rows"
        :key="r.deviceId"
        :member="r"
        :network-id="networkId"
        :os="osOf(r.deviceId)"
        :now="now"
        narrow
        @remove="remove(r)"
      />
    </ul>
    <div v-else class="overflow-hidden rounded-card border border-hairline bg-surface-card">
      <table class="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col style="width: 32%" />
          <col style="width: 22%" />
          <col style="width: 18%" />
          <col style="width: 22%" />
          <col style="width: 56px" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('network.members.cols.member') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('network.members.cols.ip') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('network.members.cols.version') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('network.members.cols.state') }}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          <MemberRowView
            v-for="r in rows"
            :key="r.deviceId"
            :member="r"
            :network-id="networkId"
            :os="osOf(r.deviceId)"
            :now="now"
            :narrow="false"
            @remove="remove(r)"
          />
        </tbody>
      </table>
    </div>

    <TemporaryPeersList v-if="peers.length > 0" :peers="peers" :now="now" />

    <AddMembersDialog v-model:open="adding" :network-id="networkId" :secure="ctx.detail.value?.secure_mode === true" />
  </div>
</template>
