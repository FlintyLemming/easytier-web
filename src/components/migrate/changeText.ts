import type { Blocker, Change, ChangeKey } from '../../domain/migration/classify'

type T = (key: string, values?: Record<string, unknown>) => string

const KNOWN: ChangeKey[] = ['connectivity', 'network_name', 'network_secret', 'dhcp', 'network_length', 'secure_mode', 'acl', 'vpn_portal', 'fixed_ip']

export function changeLabel(t: T, key: ChangeKey): string {
  return KNOWN.includes(key) ? t(`migrate.preview.kinds.${key}`) : key
}

const onOff = (t: T, v: string) => (v === 'true' ? t('migrate.preview.on') : t('migrate.preview.off'))

/** One line describing a change: 「{label}：{from} → {to}」. */
export function changeText(t: T, c: Change): string {
  const label = changeLabel(t, c.key)
  const none = t('migrate.preview.none')
  let from = c.from || none
  let to = c.to || none
  switch (c.key) {
    case 'dhcp':
    case 'secure_mode':
      from = onOff(t, c.from)
      to = onOff(t, c.to)
      break
    case 'network_length':
      from = `/${c.from}`
      to = `/${c.to}`
      break
    case 'acl':
      from = t('migrate.preview.aclRules', { n: Number(c.from) })
      to = t('migrate.preview.aclTo')
      break
    case 'vpn_portal':
      if (c.to === 'dropped') return `${label}：${t('migrate.preview.vpnDropped')}`
      to = t('migrate.preview.vpnOff')
      break
    case 'connectivity':
    case 'network_name':
    case 'network_secret':
    case 'fixed_ip':
      break
    default:
      to = t('migrate.preview.byNetwork')
  }
  return t('migrate.preview.change', { label, from, to })
}

export function blockerText(t: T, b: Blocker): string {
  switch (b.kind) {
    case 'ipOutsideCidr':
      return t('migrate.preview.blockers.ipOutsideCidr', { ip: b.ip, cidr: b.cidr })
    case 'noFreeIp':
      return t('migrate.preview.blockers.noFreeIp', { cidr: b.cidr })
    default:
      return t(`migrate.preview.blockers.${b.kind}`, { ip: b.ip, other: b.other })
  }
}
