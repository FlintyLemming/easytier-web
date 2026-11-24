<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TemporaryPeer } from '../../api/types'
import { elapsedText } from '../../domain/format'
import SectionCard from '../ui/SectionCard.vue'

/** Devices online through a credential without being members (`temporary_peers`). */
const props = defineProps<{ peers: TemporaryPeer[]; now: Date }>()
const { t, locale } = useI18n()

function expiry(unix: number | null): string {
  if (unix === null) return '—'
  const at = new Date(unix * 1000)
  if (at.getTime() <= props.now.getTime()) return t('network.members.expired')
  return t('network.members.expires', { time: elapsedText(props.now.toISOString(), at, locale.value === 'en' ? 'en' : 'zh-CN') })
}
</script>

<template>
  <div data-testid="temporary-peers">
    <SectionCard :title="t('network.temporaryPeers')" :meta="String(peers.length)">
      <ul class="flex flex-col">
        <li
          v-for="p in peers"
          :key="p.peer_id"
          class="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-hairline-soft py-2.5 first:border-t-0 first:pt-0 last:pb-0"
        >
          <span class="min-w-0 truncate text-[14px] text-ink">{{ p.hostname || `#${p.peer_id}` }}</span>
          <span class="font-mono text-[13px] text-ink">{{ p.ipv4 || '—' }}</span>
          <span class="font-mono text-[12px] text-muted">{{ p.version || '—' }}</span>
          <span class="text-[12px] text-muted">{{ t('network.temporaryPeersCredential') }} <span class="font-mono">{{ p.credential_id ?? '—' }}</span></span>
          <span class="text-[12px] text-muted">{{ expiry(p.credential_expiry_unix) }}</span>
        </li>
      </ul>
    </SectionCard>
  </div>
</template>
