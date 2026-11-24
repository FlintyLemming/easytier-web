<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { createVpnPortalConfig, LEGACY_VPN_FIELDS, splitLegacyVpn, usesLegacyVpn } from '../../domain/vpnPortal'
import type { NetworkConfig, VpnPortalClientConfig } from '../../lib/networkConfig'
import UiInput from '../ui/UiInput.vue'
import AddButton from './AddButton.vue'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import NumberField from './NumberField.vue'
import {
  cidrRule,
  flagOn,
  legacyNetworkRule,
  legacyNetworkText,
  parseLegacyNetwork,
  portRule,
  requiredRule,
  setFlag,
  useInvalidText,
  vpnPortalOn,
} from './rules'
import { FIELD_CLASS, LABEL_CLASS, REMOVE_CLASS } from './styles'

const props = defineProps<{
  draft: NetworkConfig
  mode: 'member' | 'instance'
  coreVersion: string
  /** The config as the editor read it; turning a portal back off returns to how it was there. */
  opened: NetworkConfig
}>()
const { t } = useI18n()
const invalid = useInvalidText()
const clientsId = useId()
const groupsId = useId()

// Cores before 2.7 only understand the legacy fields (and drop `vpn_portal_config`).
const legacy = computed(() => usesLegacyVpn(props.coreVersion, props.draft))
// R18: web 2.7.1 compiles every member override through gen_config, which refuses the legacy fields
// once the portal is on, so a member on such a core gets a note instead of a switch that could
// never save. Legacy fields an override already has stay exactly as read.
const memberLegacy = computed(() => props.mode === 'member' && legacy.value)
const openedLegacy = computed(() => splitLegacyVpn(props.opened).legacy)

// --- legacy: one shared WireGuard config for a client network ---

// Like any switch, off (the default) leaves `enable_vpn_portal` out. The port and network are hidden
// while off, so they go back to how they were read: turning the portal on and off again changes
// nothing, and values the config already had are there next time.
function setLegacyOn(on: boolean) {
  const d = props.draft
  setFlag(d, 'enable_vpn_portal', on)
  if (!on) {
    const rec = d as unknown as Record<string, unknown>
    for (const field of LEGACY_VPN_FIELDS) {
      if (field === 'enable_vpn_portal') continue
      if (field in openedLegacy.value) rec[field] = openedLegacy.value[field]
      else delete rec[field]
    }
    return
  }
  d.vpn_portal_listen_port ??= 22022
  if (!d.vpn_portal_client_network_addr && d.vpn_portal_client_network_len === undefined) {
    d.vpn_portal_client_network_addr = '10.14.14.0'
    d.vpn_portal_client_network_len = 24
  }
}

function setLegacyNetwork(text: string) {
  const { addr, len } = parseLegacyNetwork(text)
  props.draft.vpn_portal_client_network_addr = addr
  props.draft.vpn_portal_client_network_len = len
}

// --- 2.7+: named clients ---

// Toggling back returns to the config as read. A portal the config did not have is created on 启用
// and removed again on 关闭 (rather than left behind disabled, with a fresh key). One it had is
// disabled with `enabled = false` and keeps the rest; 启用 then puts `enabled` back as read, where
// leaving it out means enabled.
function setOn(on: boolean) {
  const d = props.draft
  const read = props.opened.vpn_portal_config
  if (!d.vpn_portal_config) {
    if (on) d.vpn_portal_config = createVpnPortalConfig()
    return
  }
  if (on) {
    if (read && read.enabled == null) delete d.vpn_portal_config.enabled
    else d.vpn_portal_config.enabled = true
  } else if (!read) {
    delete d.vpn_portal_config
  } else {
    d.vpn_portal_config.enabled = false
  }
}

function addClient() {
  props.draft.vpn_portal_config!.clients.push({ name: '', virtual_ip: '', groups: [] })
}

function removeClient(i: number) {
  props.draft.vpn_portal_config!.clients.splice(i, 1)
}

// Applied on change, not on every keystroke, so a trailing comma survives typing.
function setGroups(client: VpnPortalClientConfig, text: string) {
  client.groups = text.split(',').map((g) => g.trim()).filter(Boolean)
}
</script>

<template>
  <EditorSection name="vpnPortal" :title="t('config.section.vpnPortal')">
    <p v-if="memberLegacy" class="text-[13px] text-muted">{{ t('config.vpn.memberLegacyNote') }}</p>

    <template v-else-if="legacy">
      <p class="text-[13px] text-muted">{{ t('config.vpn.legacyHint') }}</p>
      <CheckboxField :model-value="flagOn(draft, 'enable_vpn_portal')" :label="t('config.field.vpnEnabled')" @update:model-value="setLegacyOn" />
      <div v-if="flagOn(draft, 'enable_vpn_portal')" class="grid gap-4 sm:grid-cols-[160px_1fr]">
        <NumberField
          :model-value="draft.vpn_portal_listen_port"
          :label="t('config.field.vpnLegacyPort')"
          placeholder="22022"
          :min="1"
          :max="65535"
          :error="invalid(portRule(draft.vpn_portal_listen_port))"
          @update:model-value="(v) => (draft.vpn_portal_listen_port = v ?? NaN)"
        />
        <UiInput
          :model-value="legacyNetworkText(draft.vpn_portal_client_network_addr, draft.vpn_portal_client_network_len)"
          class="sm:max-w-[260px]"
          :label="t('config.field.vpnLegacyNetwork')"
          placeholder="10.14.14.0/24"
          mono
          :error="invalid(legacyNetworkRule(draft.vpn_portal_client_network_addr, draft.vpn_portal_client_network_len))"
          @update:model-value="setLegacyNetwork"
        />
      </div>
    </template>

    <template v-else>
      <CheckboxField :model-value="vpnPortalOn(draft)" :label="t('config.field.vpnEnabled')" @update:model-value="setOn" />
      <template v-if="vpnPortalOn(draft) && draft.vpn_portal_config">
        <UiInput
          v-model="draft.vpn_portal_config.wireguard_listen"
          class="sm:max-w-[320px]"
          :label="t('config.field.vpnListen')"
          placeholder="0.0.0.0:22022"
          mono
          :error="invalid(requiredRule(draft.vpn_portal_config.wireguard_listen))"
        />
        <div role="group" :aria-labelledby="clientsId" class="flex flex-col gap-3">
          <span :id="clientsId" class="text-[13px] text-ink">{{ t('config.field.vpnClients') }}</span>
          <ul v-if="draft.vpn_portal_config.clients.length" class="flex flex-col gap-4">
            <li
              v-for="(client, i) in draft.vpn_portal_config.clients"
              :key="i"
              class="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <UiInput
                v-model="client.name"
                :label="t('config.field.vpnClientName')"
                placeholder="phone"
                mono
                :error="invalid(requiredRule(client.name))"
              />
              <UiInput
                v-model="client.virtual_ip"
                :label="t('config.field.vpnClientIp')"
                placeholder="10.144.144.20/24"
                mono
                :error="invalid(cidrRule(client.virtual_ip))"
              />
              <div class="flex flex-col gap-1.5">
                <label :for="`${groupsId}-${i}`" :class="LABEL_CLASS">{{ t('config.field.vpnClientGroups') }}</label>
                <input
                  :id="`${groupsId}-${i}`"
                  type="text"
                  :value="client.groups.join(', ')"
                  :class="[FIELD_CLASS, 'border-hairline-strong font-mono']"
                  @change="setGroups(client, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <button type="button" :aria-label="t('config.remove')" :class="[REMOVE_CLASS, 'sm:mt-[22px]']" @click="removeClient(i)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </li>
          </ul>
          <AddButton @click="addClient">{{ t('config.add') }}</AddButton>
        </div>
      </template>
    </template>
  </EditorSection>
</template>
