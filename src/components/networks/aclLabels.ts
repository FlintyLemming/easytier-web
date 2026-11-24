import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AclProtocolTarget, CentralNetworkMember } from '../../api/types'
import type { SelectorKey } from '../../domain/acl'
import { memberIp } from '../../domain/devices'
import { memberName } from '../../domain/networks'

export interface SelectorOption {
  key: SelectorKey
  label: string
}

/** Display text for ACL selectors and protocols, from the network's current members. */
export function useAclLabels(members: ComputedRef<CentralNetworkMember[]>) {
  const { t, locale } = useI18n()
  const byId = computed(() => new Map(members.value.map((m) => [m.member_id, m])))
  const sep = () => (locale.value === 'en' ? ', ' : '、')

  const nameOf = (id: string) => {
    const m = byId.value.get(id)
    return m ? memberName(m) : t('acl.unknownMember', { id: id.slice(0, 8) })
  }

  function selectorText(key: SelectorKey): string {
    if (key === 'all') return t('acl.allMembers')
    if (key.startsWith('member:')) return nameOf(key.slice('member:'.length))
    if (key.startsWith('subnet:')) {
      const rest = key.slice('subnet:'.length)
      const i = rest.indexOf(':')
      return t('acl.subnetOf', { name: nameOf(rest.slice(0, i)), cidr: rest.slice(i + 1) })
    }
    const group = key.slice('group:'.length)
    // A temporary member's credential grants the group `member:<member_id>`.
    const m = group.startsWith('member:') ? byId.value.get(group.slice('member:'.length)) : undefined
    return m ? t('acl.temporaryGroup', { name: memberName(m) }) : group
  }

  function selectorSummary(keys: SelectorKey[]): string {
    const texts = keys.map(selectorText)
    if (texts.length <= 3) return texts.join(sep())
    return `${texts.slice(0, 3).join(sep())} ${t('acl.more', { n: texts.length - 3 })}`
  }

  function protocolSummary(protocols: AclProtocolTarget[]): string {
    return protocols
      .map((p) => {
        const name = t(`acl.proto.${p.protocol}`)
        if (p.protocol === 'icmp' || p.protocol === 'icmpv6') return name
        const ports = p.ports.length ? p.ports.join(', ') : t('acl.allPorts')
        return `${name} ${ports}${p.stateful ? ` · ${t('acl.stateful')}` : ''}`
      })
      .join(locale.value === 'en' ? '; ' : '；')
  }

  function memberOption(m: CentralNetworkMember): SelectorOption {
    const ip = memberIp(m)
    return { key: `member:${m.member_id}`, label: ip ? `${memberName(m)} ${ip}` : memberName(m) }
  }

  return { selectorText, selectorSummary, protocolSummary, memberOption }
}
