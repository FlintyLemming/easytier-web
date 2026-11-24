import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from '../../src/i18n/zh-CN'
import en from '../../src/i18n/en'
import { formFlags } from '../../src/lib/networkConfig'

function keys(o: Record<string, unknown>, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, p + k + '.') : [p + k],
  )
}

function translator(locale: 'zh-CN' | 'en') {
  return createI18n({ legacy: false, locale, messages: { 'zh-CN': zh, en } }).global.t
}

describe('i18n catalogs', () => {
  it('zh-CN and en have identical keys', () => {
    expect(keys(en).sort()).toEqual(keys(zh).sort())
  })

  it('overview counts read right in English, singular and plural', () => {
    const t = translator('en')
    expect(t('overview.attention.outdated', { n: 1 }, 1)).toBe('1 device can be updated')
    expect(t('overview.attention.outdated', { n: 3 }, 3)).toBe('3 devices can be updated')
    expect(t('overview.attention.blockedSub', { n: 1, time: 'now' }, 1)).toBe('Blocked · 1 attempt · last now')
    expect(t('overview.attention.blockedSub', { n: 5, time: 'now' }, 5)).toBe('Blocked · 5 attempts · last now')
    expect(t('overview.map.clusterLabel', { name: 'Tokyo', total: 1, online: 1 }, 1)).toBe('Tokyo, 1 device, 1 online')
    expect(t('overview.map.clusterLabel', { name: 'Tokyo', total: 3, online: 2 }, 3)).toBe('Tokyo, 3 devices, 2 online')
    expect(t('overview.map.chipLabel', { name: 'LA', total: 1 }, 1)).toBe('LA, 1 device, switch to the world view')
    expect(t('overview.map.chipLabel', { name: 'LA', total: 2 }, 2)).toBe('LA, 2 devices, switch to the world view')
    expect(t('overview.ranking.others', { n: 1 }, 1)).toBe('1 more place')
    expect(t('overview.ranking.others', { n: 4 }, 4)).toBe('4 more places')
    expect(t('overview.stats.directSub', { relayed: 0, total: 1 }, 1)).toBe('0 of 1 connection relayed')
    expect(t('overview.stats.directSub', { relayed: 3, total: 136 }, 136)).toBe('3 of 136 connections relayed')
    // {n} is the total number of places, the first one included.
    expect(t('devices.cityChipMany', { city: 'Shanghai', n: 2 })).toBe('Location: Shanghai and others (2 places)')
  })

  it('zh-CN reads the same whatever the plural count', () => {
    const t = translator('zh-CN')
    expect(t('overview.attention.outdated', { n: 1 }, 1)).toBe('1 台设备可更新')
    expect(t('overview.attention.blockedSub', { n: 5, time: '10 分钟前' }, 5)).toBe('已拉黑 · 共尝试 5 次 · 最后 10 分钟前')
    expect(t('overview.map.clusterLabel', { name: '东京', total: 1, online: 1 }, 1)).toBe('东京，1 台设备，1 台在线')
    expect(t('overview.map.chipLabel', { name: '洛杉矶', total: 1 }, 1)).toBe('洛杉矶，1 台设备，切换到世界视图')
    expect(t('overview.ranking.others', { n: 1 }, 1)).toBe('其他 1 地')
    expect(t('overview.stats.directSub', { relayed: 3, total: 136 }, 136)).toBe('136 条连接中 3 条走中继')
    expect(t('devices.cityChipMany', { city: '上海', n: 2 })).toBe('位置：上海 等 2 地')
  })

  it('every form flag has a label and help text in both catalogs', () => {
    for (const catalog of [zh, en] as unknown as { config: { flags: Record<string, { label: string; help: string }> } }[]) {
      for (const { field } of formFlags()) {
        const entry = catalog.config.flags[field]
        expect(entry?.label, field).toBeTruthy()
        expect(entry?.help, field).toBeTruthy()
      }
    }
  })

  it('no form flag is labelled with its field name; the UDP FEC flags have help beyond their label (F10)', () => {
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
    for (const catalog of [zh, en] as unknown as { config: { flags: Record<string, { label: string; help: string }> } }[]) {
      for (const { field } of formFlags()) {
        const { label } = catalog.config.flags[field]!
        expect(same(label, field), field).toBe(false)
        expect(label, field).not.toContain('_')
      }
      // (Some upstream help only repeats its label, e.g. en disable_udp_hole_punching; SectionFlags hides those.)
      for (const field of ['enable_udp_fec', 'enable_udp_fec_kcp', 'enable_udp_fec_quic']) {
        const { label, help } = catalog.config.flags[field]!
        expect(same(help, label), field).toBe(false)
      }
    }
    expect(zh.config.flags.enable_udp_fec!.label).toBe('启用 UDP FEC')
    expect(en.config.flags.enable_udp_fec!.label).toBe('Enable UDP FEC')
  })
})
