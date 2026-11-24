<script setup lang="ts">
import { computed, provide, reactive, ref, useId, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { getGatewayInfo, getNetwork } from '../api/client'
import type { CentralNetworkDetail, GatewayInfo } from '../api/types'
import AclTab from '../components/networks/AclTab.vue'
import CredentialsTab from '../components/networks/CredentialsTab.vue'
import MembersTab from '../components/networks/MembersTab.vue'
import NetworkTabs from '../components/networks/NetworkTabs.vue'
import SettingsTab from '../components/networks/SettingsTab.vue'
import { networkDetailKey, type NetworkTab } from '../components/networks/context'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import { errorMessage } from '../components/device-detail/writes'
import { useConfirm } from '../composables/useConfirm'
import { useInventory } from '../stores/inventory'
import { useSession } from '../stores/session'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const inventory = useInventory()
const session = useSession()

watchEffect(() => {
  if (session.webhookMode) void router.replace('/')
})

// Leaving the page (or switching to another network) drops an unsaved ACL draft, so ask first.
const { confirm } = useConfirm()
const aclTab = ref<{ dirty: boolean } | null>(null)
async function mayLeaveAcl(): Promise<boolean> {
  if (!aclTab.value?.dirty) return true
  return confirm({ title: t('acl.leaveTitle'), confirmLabel: t('acl.leaveConfirm') })
}
onBeforeRouteLeave(() => mayLeaveAcl())
onBeforeRouteUpdate((to, from) => (to.params.networkId === from.params.networkId ? true : mayLeaveAcl()))

const networkId = computed(() => (typeof route.params.networkId === 'string' ? route.params.networkId : ''))
const detail = ref<CentralNetworkDetail | null>(null)
const gateway = ref<GatewayInfo | null>(null)
const state = ref<'loading' | 'ready' | 'notFound' | 'error'>('loading')
const loadError = ref('')

let generation = 0
async function load(initial: boolean) {
  const gen = ++generation
  const id = networkId.value
  if (initial) state.value = 'loading'
  try {
    const [d, g] = await Promise.all([getNetwork(id), gateway.value && !initial ? Promise.resolve(gateway.value) : getGatewayInfo()])
    if (gen !== generation) return
    detail.value = d
    gateway.value = g
    state.value = 'ready'
  } catch (e) {
    if (gen !== generation) return
    if (!initial && detail.value) throw e
    state.value = e instanceof ApiError && e.status === 404 ? 'notFound' : 'error'
    loadError.value = errorMessage(e)
  }
}

provide(networkDetailKey, { detail, gateway, reload: () => load(false) })

const visited = reactive(new Set<NetworkTab>())
watch(
  networkId,
  (id) => {
    if (!id || session.webhookMode) return
    detail.value = null
    visited.clear()
    void load(true)
  },
  { immediate: true },
)

const summary = computed(() => inventory.networks.find((n) => n.network_id === networkId.value) ?? null)

const tabs = computed(() => {
  const list: { key: NetworkTab; label: string }[] = [
    { key: 'members', label: t('network.tabs.members') },
    { key: 'acl', label: t('network.tabs.acl') },
  ]
  if (detail.value?.secure_mode) list.push({ key: 'credentials', label: t('network.tabs.credentials') })
  list.push({ key: 'settings', label: t('network.tabs.settings') })
  return list
})

const tab = computed<NetworkTab>({
  get: () => {
    const q = route.query.tab
    return tabs.value.find((x) => x.key === q)?.key ?? 'members'
  },
  set: (key) => {
    const { tab: _drop, ...rest } = route.query
    void router.push({ query: key === 'members' ? rest : { ...rest, tab: key } })
  },
})
watch(tab, (key) => visited.add(key), { immediate: true })

const panelBase = useId()
const panelId = (key: NetworkTab) => `${panelBase}-${key}`
</script>

<template>
  <div class="flex flex-col gap-6">
    <nav :aria-label="t('detail.breadcrumb')" class="text-[13px] text-muted">
      <RouterLink :to="{ name: 'networks', query: { list: '1' } }" class="hover:text-ink">{{ t('network.breadcrumb') }}</RouterLink>
      <template v-if="detail">
        <span class="mx-1.5" aria-hidden="true">/</span>
        <span class="text-ink">{{ detail.display_name }}</span>
      </template>
    </nav>

    <SkeletonRows v-if="state === 'loading'" :rows="5" />

    <EmptyState v-else-if="state === 'notFound'" :title="t('network.notFound')" :body="t('network.notFoundBody')">
      <template #action>
        <RouterLink
          :to="{ name: 'networks', query: { list: '1' } }"
          class="inline-flex h-10 items-center rounded-control border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink"
        >{{ t('network.backToList') }}</RouterLink>
      </template>
    </EmptyState>

    <EmptyState v-else-if="state === 'error'" :title="t('network.loadFailed')" :body="loadError">
      <template #action><UiButton @click="load(true)">{{ t('network.retry') }}</UiButton></template>
    </EmptyState>

    <template v-else-if="detail">
      <header>
        <h1 class="text-[26px] font-normal tracking-[-0.325px] text-ink">{{ detail.display_name }}</h1>
        <p data-testid="network-subline" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
          <span class="font-mono">{{ detail.network_name }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ t(`networks.method.${detail.networking_method}`) }}</span>
          <template v-if="detail.virtual_cidr">
            <span aria-hidden="true">·</span>
            <span class="font-mono">{{ detail.virtual_cidr }}</span>
          </template>
          <template v-if="summary">
            <span aria-hidden="true">·</span>
            <span>{{ t('network.onlineCount', { online: summary.online_member_count, total: summary.member_count }) }}</span>
          </template>
          <UiBadge v-if="detail.secure_mode" tone="outline">{{ t('networks.secureBadge') }}</UiBadge>
        </p>
      </header>

      <NetworkTabs v-model="tab" :tabs="tabs" :label="t('network.tabs.label')" :panel-id="panelId" />

      <div v-if="visited.has('members')" v-show="tab === 'members'" :id="panelId('members')" role="tabpanel">
        <MembersTab :network-id="networkId" />
      </div>
      <div v-if="visited.has('acl')" v-show="tab === 'acl'" :id="panelId('acl')" role="tabpanel">
        <AclTab ref="aclTab" :network-id="networkId" />
      </div>
      <div v-if="detail.secure_mode && visited.has('credentials')" v-show="tab === 'credentials'" :id="panelId('credentials')" role="tabpanel">
        <CredentialsTab :network-id="networkId" :active="tab === 'credentials'" />
      </div>
      <div v-if="visited.has('settings')" v-show="tab === 'settings'" :id="panelId('settings')" role="tabpanel">
        <SettingsTab :network-id="networkId" />
      </div>
    </template>
  </div>
</template>
