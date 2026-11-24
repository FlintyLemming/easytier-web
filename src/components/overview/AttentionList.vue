<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { addMembers, unblockDevice } from '../../api/client'
import { useToast } from '../../composables/useToast'
import { buildAttention, type AttentionItem } from '../../domain/attention'
import type { DeviceView } from '../../domain/devices'
import { elapsedText, locationText, relativeTime } from '../../domain/format'
import { useInventory } from '../../stores/inventory'
import EmptyState from '../ui/EmptyState.vue'
import SectionCard from '../ui/SectionCard.vue'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{ central: boolean }>()
const { t, locale } = useI18n()
const inventory = useInventory()
const toast = useToast()

const LIMIT = 5
const expanded = ref(false)

const now = ref(new Date())
const tick = setInterval(() => { now.value = new Date() }, 30_000)
onBeforeUnmount(() => clearInterval(tick))
const lang = computed(() => (locale.value === 'en' ? 'en' : 'zh-CN'))

const items = computed(() =>
  buildAttention({
    devices: inventory.devices,
    blocked: inventory.blocked,
    central: props.central,
    hasPrimary: inventory.primaryNetwork !== null,
    now: now.value.getTime(),
  }),
)
const visible = computed(() => (expanded.value ? items.value : items.value.slice(0, LIMIT)))
const primaryName = computed(() => inventory.primaryNetwork?.display_name ?? '')

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** A refresh already in flight may carry pre-mutation data, so refresh twice. */
async function refreshFresh() {
  await inventory.refresh()
  await inventory.refresh()
}

const busy = reactive(new Set<string>())
const keyOf = (i: AttentionItem) =>
  i.kind === 'blocked' ? `blocked:${i.id}` : i.kind === 'outdated' ? 'outdated' : `${i.kind}:${i.device.id}`

async function unblock(id: string) {
  const key = `blocked:${id}`
  if (busy.has(key)) return
  busy.add(key)
  try {
    await unblockDevice(id)
    toast.success(t('overview.attention.unblocked'))
    await refreshFresh()
  } catch (e) {
    toast.error(t('overview.attention.unblockFailed', { message: msg(e) }))
  } finally {
    busy.delete(key)
  }
}

async function join(d: DeviceView) {
  const net = inventory.primaryNetwork
  const key = `unjoined:${d.id}`
  if (!net || busy.has(key)) return
  busy.add(key)
  try {
    await addMembers(net.network_id, [d.id])
    toast.success(t('devices.joined', { name: d.name, network: net.display_name }))
    await refreshFresh()
  } catch (e) {
    toast.error(t('devices.joinFailed', { message: msg(e) }))
  } finally {
    busy.delete(key)
  }
}

const joinParts = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')

function glyph(i: AttentionItem): string {
  return { blocked: '⊘', unjoined: '＋', offline: '○', outdated: '↑' }[i.kind]
}

function title(i: AttentionItem): string {
  switch (i.kind) {
    case 'blocked': return t('overview.attention.blocked', { name: i.name })
    case 'unjoined': return t('overview.attention.unjoined', { name: i.device.name })
    case 'offline':
      return t('overview.attention.offline', { name: i.device.name, duration: elapsedText(i.since, now.value, lang.value) })
    case 'outdated': return t('overview.attention.outdated', { n: i.count }, i.count)
  }
}

function sub(i: AttentionItem): string {
  switch (i.kind) {
    case 'blocked':
      return t(
        'overview.attention.blockedSub',
        { n: i.attempts, time: i.lastAttempt ? relativeTime(i.lastAttempt, now.value, lang.value) : '—' },
        i.attempts,
      )
    case 'unjoined': {
      const d = i.device
      return joinParts([
        d.os,
        locationText(d.knownLocation),
        d.online
          ? t('devices.online')
          : d.lastSeen && t('overview.attention.lastSeen', { time: relativeTime(d.lastSeen, now.value, lang.value) }),
      ])
    }
    case 'offline':
      return joinParts([
        locationText(i.device.knownLocation),
        i.device.ip && t('overview.attention.lastIp', { ip: i.device.ip }),
      ])
    case 'outdated':
      return i.byVersion.map((g) => `${g.names.join('、')} ${g.version}`).join(' · ')
  }
}
</script>

<template>
  <SectionCard data-testid="attention-list" :title="t('overview.attention.title', { n: items.length })">
    <template v-if="items.length > LIMIT" #action>
      <UiButton variant="text" size="sm" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? t('overview.attention.collapse') : t('overview.attention.all', { n: items.length }) }}
      </UiButton>
    </template>
    <EmptyState v-if="items.length === 0" :title="t('overview.attention.empty')" :body="t('overview.attention.emptyBody')" />
    <ul v-else class="-my-3 flex flex-col">
      <li
        v-for="i in visible"
        :key="keyOf(i)"
        data-testid="attention-row"
        class="flex items-center gap-3 border-t border-hairline-soft py-3 first:border-t-0"
      >
        <span class="w-4 shrink-0 text-center text-[14px] text-muted" aria-hidden="true">{{ glyph(i) }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] text-ink" :title="title(i)">
            <RouterLink v-if="i.kind === 'offline'" :to="`/devices/${i.device.id}`" class="hover:underline">{{ title(i) }}</RouterLink>
            <template v-else>{{ title(i) }}</template>
          </p>
          <p v-if="sub(i)" class="truncate text-[13px] text-muted" :title="sub(i)">{{ sub(i) }}</p>
        </div>
        <UiButton
          v-if="i.kind === 'blocked'"
          variant="secondary"
          size="sm"
          :loading="busy.has(keyOf(i))"
          :aria-label="t('overview.attention.unblockLabel', { name: i.name })"
          @click="unblock(i.id)"
        >{{ t('overview.attention.unblock') }}</UiButton>
        <UiButton
          v-else-if="i.kind === 'unjoined'"
          variant="secondary"
          size="sm"
          :loading="busy.has(keyOf(i))"
          :aria-label="t('overview.attention.joinLabel', { name: i.device.name, network: primaryName })"
          @click="join(i.device)"
        >{{ t('devices.join', { network: primaryName }) }}</UiButton>
      </li>
    </ul>
  </SectionCard>
</template>
