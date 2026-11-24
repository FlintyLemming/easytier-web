import { useI18n } from 'vue-i18n'
import type { LinkMode } from '../domain/connections'

export function useLinkFormat() {
  const { t } = useI18n()

  function modeLabel(mode: LinkMode): string {
    if (mode.type === 'p2p') return t('detail.connections.p2p', { tunnel: mode.tunnel.toUpperCase() })
    // Spec §6.4: relays through infrastructure read 「中继 · 经 网关/服务器」, not the node's hostname.
    if (mode.viaKind === 'infra') {
      return t('detail.connections.relay', { via: t(`detail.connections.infra.${mode.viaInfra ?? 'server'}`) })
    }
    return t('detail.connections.relay', { via: mode.via })
  }

  function latencyText(ms: number | null): string {
    if (ms === null) return '—'
    if (ms < 10) return `${Math.round(ms * 10) / 10} ms`
    return `${Math.round(ms)} ms`
  }

  return { modeLabel, latencyText }
}
