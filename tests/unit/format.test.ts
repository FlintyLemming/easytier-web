import { describe, expect, it } from 'vitest'
import {
  formatBytes, ipv4FromU32, locationText, osLabel, publicIpFromClientUrl, relativeTime,
} from '../../src/domain/format'

describe('format', () => {
  it('ipv4FromU32', () => {
    expect(ipv4FromU32(0x0a909001)).toBe('10.144.144.1')
  })
  it('publicIpFromClientUrl', () => {
    expect(publicIpFromClientUrl('udp://1.2.3.4:5678')).toBe('1.2.3.4')
    expect(publicIpFromClientUrl('tcp://[2001:db8::1]:11010')).toBe('2001:db8::1')
    expect(publicIpFromClientUrl(null)).toBeNull()
    expect(publicIpFromClientUrl('nonsense')).toBeNull()
  })
  it('osLabel', () => {
    expect(osLabel({ os_type: 'linux', version: '3.23.4', distribution: 'Alpine Linux' })).toBe('Alpine Linux')
    expect(osLabel({ os_type: 'linux' })).toBe('linux')
    expect(osLabel(undefined)).toBe('')
  })
  it('locationText', () => {
    expect(locationText({ country: '中国', region: '浙江', city: '杭州' })).toBe('杭州')
    expect(locationText({ country: '中国', region: '浙江', city: null })).toBe('浙江')
    expect(locationText({ country: '本地网络' })).toBe('本地网络')
    expect(locationText(null)).toBeNull()
  })
  it('relativeTime', () => {
    const now = new Date('2026-11-23T12:00:00Z')
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
    const min = 60_000, h = 60 * min, d = 24 * h
    expect(relativeTime(ago(2 * d), now, 'zh-CN')).toBe('2 天前')
    expect(relativeTime(ago(10_000), now, 'zh-CN')).toBe('刚刚')
    expect(relativeTime(ago(5 * min), now, 'zh-CN')).toBe('5 分钟前')
    expect(relativeTime(ago(3 * h), now, 'zh-CN')).toBe('3 小时前')
    expect(relativeTime(ago(21 * d), now, 'zh-CN')).toBe('3 周前')
    expect(relativeTime(ago(10_000), now, 'en')).toBe('just now')
    expect(relativeTime(ago(5 * min), now, 'en')).toBe('5 min ago')
    expect(relativeTime(ago(3 * h), now, 'en')).toBe('3 h ago')
    expect(relativeTime(ago(2 * d), now, 'en')).toBe('2 days ago')
    expect(relativeTime(ago(21 * d), now, 'en')).toBe('3 weeks ago')
  })
  it('formatBytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB')
  })
})
