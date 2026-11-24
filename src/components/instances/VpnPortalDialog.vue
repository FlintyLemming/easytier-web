<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { patchVpnPortalClients, vpnPortalInfo } from '../../api/client'
import type { InstanceRunningInfo, VpnClientPatch } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { ipv4FromU32 } from '../../domain/format'
import type { InstanceRow } from '../../domain/instances'
import {
  normalizeVpnPortalEndpoint,
  randomVpnClientName,
  suggestVpnPortalAddress,
  usesLegacyVpn,
  validVpnClientName,
  validVpnPortalAddress,
  vpnPortalClientConfig,
  vpnPortalEndpoint,
  vpnPortalUsedIps,
} from '../../domain/vpnPortal'
import { copyText } from '../../lib/clipboard'
import { VpnPortalClientState, type VpnPortalClientInfo, type VpnPortalInfo } from '../../lib/networkConfig'
import { errorMessage } from '../device-detail/writes'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'

// The VPN Portal of one running manual instance (spec §6.7): its clients and their configs, adding
// and removing clients. The panel mounts it per opening, so an answer never outlives its opening.
const props = defineProps<{
  machineId: string
  row: InstanceRow
  /** The instance's running info as the panel last read it: its network, public address and peers. */
  info: InstanceRunningInfo | null
  /** The device's `easytier_version`: cores before 2.7 have one shared config, no named clients (R4). */
  coreVersion: string
  /** Nothing is sent while the device is offline; what was typed stays, the actions wait. */
  online: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const clientsId = useId()

// --- reading ---

const portal = shallowRef<VpnPortalInfo | null>(null)
/** A read has succeeded; until then the dialog shows a skeleton or the read's error. */
const loaded = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)

/** Bumped per read and on unmount: only the latest read of a mounted dialog applies its answer. */
let readSeq = 0
let disposed = false
onBeforeUnmount(() => {
  disposed = true
  readSeq++
})

async function read(): Promise<void> {
  if (disposed || !props.online) return
  const mine = ++readSeq
  loading.value = true
  try {
    const next = await vpnPortalInfo(props.machineId, props.row.id)
    if (mine !== readSeq) return
    portal.value = next
    loadError.value = null
    if (!loaded.value) {
      loaded.value = true
      endpointText.value = vpnPortalEndpoint(listener.value, props.info)
      resetForm()
    }
  } catch (e) {
    if (mine === readSeq) loadError.value = errorMessage(e)
  } finally {
    if (mine === readSeq) loading.value = false
  }
}

onMounted(read)
// A first read the device was offline for (or that failed meanwhile) is made once it is back.
watch(
  () => props.online,
  (on) => {
    if (on && !loaded.value && !loading.value) void read()
  },
)

/**
 * `unavailable`: no portal running (a 2.6 core says `ERROR: …`, a 2.7 core `vpn_type: "null"` or
 * no listener). `legacy`: a core before 2.7, whose clients all share one config (R4). `clients`: a
 * 2.7 portal with named clients.
 */
const view = computed<'unavailable' | 'legacy' | 'clients'>(() => {
  const p = portal.value
  if (!p || p.vpn_type !== 'wireguard' || p.client_config.trimStart().startsWith('ERROR')) return 'unavailable'
  const legacy = usesLegacyVpn(props.coreVersion)
  const shared = p.client_config.trim() !== ''
  if (shared && (legacy || p.clients.length === 0)) return 'legacy'
  return !legacy && p.listener ? 'clients' : 'unavailable'
})

/** What the core said about a portal that is not running, e.g. `ERROR: Wireguard VPN Portal Not Started`. */
const coreSaid = computed(() => portal.value?.client_config.trim() ?? '')

// --- the server address clients dial ---

/** A legacy config's Endpoint line holds the address the portal listens on, e.g. `0.0.0.0:22022`. */
const listener = computed(() => {
  const p = portal.value
  if (!p) return ''
  if (view.value === 'legacy') return /^Endpoint\s*=\s*(\S+)/m.exec(p.client_config)?.[1] ?? ''
  return p.listener ?? ''
})
const listenerPort = computed(() => /:(\d+)\/?$/.exec(listener.value)?.[1] ?? '')
/** Set from the listener and the node's public address once the first read is in; the user may change it. */
const endpointText = ref('')
/** The address that goes into copied configs, port included; empty while there is none usable. */
const endpoint = computed(() => normalizeVpnPortalEndpoint(endpointText.value, listenerPort.value))

const legacyText = computed(() => {
  const config = portal.value?.client_config ?? ''
  return (vpnPortalClientConfig(config, endpoint.value) || config).trim()
})

async function copy(config: string) {
  const text = vpnPortalClientConfig(config, endpoint.value)
  if (!text) return
  if (await copyText(text)) toast.success(t('vpn.copied'))
  else toast.error(t('common.copyFailed'))
}

// --- clients ---

const clients = computed(() => (view.value === 'clients' ? portal.value!.clients : []))

function stateText(state: VpnPortalClientState): string {
  if (state === VpnPortalClientState.ONLINE) return t('vpn.state.connected')
  if (state === VpnPortalClientState.CONNECTING) return t('vpn.state.connecting')
  if (state === VpnPortalClientState.ERROR) return t('vpn.state.error')
  return t('vpn.state.disconnected')
}

function stateDot(state: VpnPortalClientState): string {
  if (state === VpnPortalClientState.ONLINE) return 'bg-success'
  if (state === VpnPortalClientState.CONNECTING) return 'bg-muted'
  if (state === VpnPortalClientState.ERROR) return 'bg-error'
  return 'bg-muted-soft'
}

/**
 * The instance's network (10.88.0.3/24 stands for 10.88.0.0/24): client addresses must lie in it.
 * Unknown while the instance has no virtual IP (DHCP not done yet, or the info went away when it
 * stopped); nothing can be added then, as no address can be checked against it.
 */
const network = computed(() => {
  const v4 = props.info?.my_node_info?.virtual_ipv4
  const addr = v4?.address?.addr
  return typeof addr === 'number' && typeof v4?.network_length === 'number'
    ? `${ipv4FromU32(addr)}/${v4.network_length}`
    : undefined
})
/** Taken addresses: the clients', this node's and its peers'. */
const used = computed(() => vpnPortalUsedIps(props.info, clients.value))

// --- adding ---

const form = reactive({ name: '', address: '', prefix: '', groups: '' })
/** The address and prefix last put in the form, so a later suggestion may replace them while untouched. */
const suggested = { address: '', prefix: '' }

function suggestAddress(): { address: string; prefix: string } {
  // 2.7 cores report client addresses without a prefix, so the suggestion comes from the
  // instance's own network, the one client addresses must lie in.
  const s = suggestVpnPortalAddress(props.info, [], used.value)
  return { address: s.address, prefix: s.prefix === undefined ? '' : String(s.prefix) }
}

/**
 * A fresh random name (R15: a recycled one would restore a deleted client's access) and a free
 * address; after an add, new ones.
 */
function resetForm() {
  const s = suggestAddress()
  form.name = randomVpnClientName(new Set(clients.value.map((c) => c.name)))
  form.address = s.address
  form.prefix = s.prefix
  form.groups = ''
  Object.assign(suggested, s)
}

// The network may only become known after the first read (a DHCP instance getting its IP): an
// address and prefix nobody has typed over then take the suggestion for it.
watch(network, (net) => {
  if (!net || !loaded.value || view.value !== 'clients') return
  const s = suggestAddress()
  if (form.address.trim() === '' || form.address === suggested.address) {
    form.address = s.address
    suggested.address = s.address
  }
  if (form.prefix.trim() === '' || form.prefix === suggested.prefix) {
    form.prefix = s.prefix
    suggested.prefix = s.prefix
  }
})

const name = computed(() => form.name.trim())
const address = computed(() => form.address.trim())
const prefix = computed(() => (/^\d{1,2}$/.test(form.prefix.trim()) ? Number(form.prefix.trim()) : undefined))
const nameError = computed(() => {
  if (!validVpnClientName(name.value)) return t('vpn.invalidName')
  if (clients.value.some((c) => c.name === name.value)) return t('vpn.duplicate')
  return undefined
})
/** Never valid while the instance network is unknown: an address outside it could not be told apart. */
const addressValid = computed(
  () => network.value !== undefined && validVpnPortalAddress(address.value, prefix.value, used.value, network.value),
)
/** The address field's own complaint; while the network is unknown the form says why instead. */
const addressError = computed(() => (network.value !== undefined && !addressValid.value ? t('vpn.invalidAddress') : undefined))

// --- writing ---

/** The patch under way, if any: every action waits for it, and the dialog stays open meanwhile. */
const working = ref<{ action: 'ADD' | 'REMOVE'; name: string } | null>(null)
const busy = computed(() => working.value !== null)
/** The backend's message for the last failed patch, as it said it. */
const patchError = ref<string | null>(null)
const canAdd = computed(() => !nameError.value && addressValid.value && !busy.value && props.online)

function stillOnline(): boolean {
  if (props.online) return true
  toast.error(t('instances.offline'))
  return false
}

/**
 * Sends one patch, then shows its effect at once and reads the portal again for the core's own view
 * (state, config). The device is checked right before the request, after any confirm.
 */
async function send(
  patch: Exclude<VpnClientPatch, { action: 'CLEAR' }>,
  done: string,
  apply: (list: VpnPortalClientInfo[]) => VpnPortalClientInfo[],
): Promise<boolean> {
  if (disposed || busy.value || !stillOnline()) return false
  working.value = { action: patch.action, name: patch.client.name }
  patchError.value = null
  try {
    await patchVpnPortalClients(props.machineId, props.row.id, [patch])
  } catch (e) {
    patchError.value = errorMessage(e)
    working.value = null
    return false
  }
  toast.success(done)
  if (portal.value) portal.value = { ...portal.value, clients: apply(portal.value.clients) }
  await read()
  working.value = null
  return true
}

async function add() {
  if (!canAdd.value) return
  const client = {
    name: name.value,
    virtual_ip: `${address.value}/${prefix.value}`,
    groups: form.groups.split(',').map((g) => g.trim()).filter(Boolean),
  }
  const ok = await send({ action: 'ADD', client }, t('vpn.added', { name: client.name }), (list) => [
    ...list,
    { ...client, state: VpnPortalClientState.UNSPECIFIED, client_config: '' },
  ])
  if (ok) resetForm()
}

async function remove(client: VpnPortalClientInfo) {
  if (busy.value || !stillOnline()) return
  const ok = await confirm({
    title: t('vpn.removeTitle'),
    body: t('vpn.removeBody', { name: client.name }),
    confirmLabel: t('vpn.remove'),
    danger: true,
  })
  if (!ok) return
  await send(
    { action: 'REMOVE', client: { name: client.name, virtual_ip: '', groups: [] } },
    t('vpn.removed', { name: client.name }),
    (list) => list.filter((c) => c.name !== client.name),
  )
}

// Closing mid-patch would lose its outcome (the message under the form), so it waits for the patch.
function close() {
  if (!busy.value) emit('close')
}
</script>

<template>
  <UiDialog :open="true" :title="t('vpn.title', { name: row.name })" size="wide" @update:open="(v: boolean) => !v && close()">
    <p v-if="!online" class="mb-5 text-[13px] text-muted">{{ t('instances.offline') }}</p>

    <template v-if="!loaded">
      <EmptyState v-if="loadError" :title="t('vpn.loadFailed')" :body="loadError">
        <template #action>
          <UiButton :loading="loading" :disabled="!online" @click="read">{{ t('detail.retry') }}</UiButton>
        </template>
      </EmptyState>
      <SkeletonRows v-else-if="online" :rows="4" />
    </template>

    <template v-else>
      <div
        v-if="loadError"
        role="status"
        class="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-control bg-canvas-soft px-3 py-2 text-[13px]"
      >
        <span class="min-w-0 break-words text-body">{{ t('vpn.loadFailed') }} · <span class="text-muted">{{ loadError }}</span></span>
        <UiButton size="sm" :loading="loading" :disabled="!online || busy" @click="read">{{ t('detail.retry') }}</UiButton>
      </div>

      <div v-if="view === 'unavailable'" class="flex flex-col gap-3">
        <p class="text-ink">{{ t('vpn.unavailable') }}</p>
        <pre v-if="coreSaid" class="font-mono text-[12px] break-all whitespace-pre-wrap text-muted">{{ coreSaid }}</pre>
      </div>

      <template v-else>
        <div class="grid items-start gap-4 sm:grid-cols-2">
          <dl class="flex min-w-0 flex-col gap-1.5">
            <dt class="caption-uppercase text-muted">{{ t('vpn.listener') }}</dt>
            <dd class="flex h-10 items-center truncate font-mono text-[14px] text-ink">{{ listener || '—' }}</dd>
          </dl>
          <div class="flex flex-col gap-1.5">
            <UiInput v-model="endpointText" :label="t('vpn.endpoint')" mono placeholder="vpn.example.com:22022" />
            <p v-if="!endpoint" class="text-[12px] text-muted">{{ t('vpn.endpointHint') }}</p>
          </div>
        </div>

        <template v-if="view === 'legacy'">
          <p class="mt-5 text-[13px] text-muted">{{ t('vpn.legacyNote') }}</p>
          <pre
            data-testid="vpn-legacy-config"
            class="mt-3 overflow-x-auto rounded-control border border-hairline bg-canvas-soft p-3 font-mono text-[12px] break-all whitespace-pre-wrap text-ink"
          >{{ legacyText }}</pre>
          <div class="mt-3 flex justify-end">
            <UiButton size="sm" :disabled="!endpoint" @click="copy(portal!.client_config)">{{ t('vpn.copyConfig') }}</UiButton>
          </div>
        </template>

        <template v-else>
          <section class="mt-6" :aria-labelledby="clientsId">
            <h3 :id="clientsId" class="caption-uppercase text-muted">{{ t('vpn.clients') }}</h3>
            <p v-if="clients.length === 0" class="mt-3 text-[13px] text-muted">{{ t('vpn.noClients') }}</p>
            <ul v-else class="mt-2 flex flex-col">
              <li
                v-for="client in clients"
                :key="client.name"
                data-testid="vpn-client"
                class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline-soft py-3 first:border-t-0"
              >
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div class="flex min-w-0 flex-wrap items-baseline gap-x-3">
                    <span class="truncate text-[14px] font-medium text-ink" :title="client.name">{{ client.name }}</span>
                    <span class="font-mono text-[13px] text-body">{{ client.virtual_ip }}</span>
                  </div>
                  <span class="inline-flex items-center gap-2 text-[13px] text-body">
                    <span class="h-[7px] w-[7px] shrink-0 rounded-pill" :class="stateDot(client.state)" aria-hidden="true" />
                    {{ stateText(client.state) }}
                  </span>
                  <p v-if="client.error" class="text-[12px] break-words text-error">{{ client.error }}</p>
                </div>
                <div class="flex shrink-0 gap-2">
                  <UiButton size="sm" :disabled="!endpoint || !client.client_config" @click="copy(client.client_config)">
                    {{ t('vpn.copyConfig') }}
                  </UiButton>
                  <UiButton
                    size="sm"
                    variant="danger"
                    :loading="working?.action === 'REMOVE' && working.name === client.name"
                    :disabled="busy || !online"
                    @click="remove(client)"
                  >
                    {{ t('vpn.remove') }}
                  </UiButton>
                </div>
              </li>
            </ul>
          </section>

          <form class="mt-6 flex flex-col gap-3 border-t border-hairline-soft pt-5" :aria-label="t('vpn.add')" @submit.prevent="add">
            <div class="grid items-start gap-3 sm:grid-cols-[1fr_1fr_96px]">
              <div class="flex min-w-0 flex-col gap-1.5">
                <UiInput v-model="form.name" :label="t('vpn.name')" mono :error="nameError" />
                <p class="text-[12px] text-muted">{{ t('vpn.nameHint') }}</p>
              </div>
              <UiInput v-model="form.address" :label="t('vpn.address')" mono :error="addressError" />
              <UiInput v-model="form.prefix" :label="t('vpn.prefix')" mono />
            </div>
            <p v-if="network === undefined" class="text-[13px] text-muted">{{ t('vpn.networkUnknown') }}</p>
            <UiInput v-model="form.groups" :label="t('vpn.groups')" placeholder="ops, guests" />
            <p v-if="patchError" role="alert" class="text-[13px] break-words text-error">{{ patchError }}</p>
            <div class="flex justify-end">
              <UiButton type="submit" :loading="working?.action === 'ADD'" :disabled="!canAdd">{{ t('vpn.add') }}</UiButton>
            </div>
          </form>
        </template>
      </template>
    </template>

    <template #footer>
      <UiButton variant="secondary" :disabled="busy" @click="close">{{ t('vpn.close') }}</UiButton>
    </template>
  </UiDialog>
</template>
