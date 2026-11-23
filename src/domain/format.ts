import type { GeoText } from '../api/types'

/** Convert a uint32 (as sent by the backend) to dotted-quad IPv4. */
export function ipv4FromU32(n: number): string {
  const u = n >>> 0
  return [u >>> 24, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join('.')
}

/** Host part of a client URL like `udp://1.2.3.4:5678`; IPv6 brackets removed. */
export function publicIpFromClientUrl(url?: string | null): string | null {
  if (!url) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:\[([^\]]+)\]|([^:/?#]+))/i.exec(url)
  return m ? (m[1] ?? m[2] ?? null) : null
}

/** `device_os` is `{ os_type, version, distribution }`. */
export function osLabel(deviceOs: unknown): string {
  if (!deviceOs || typeof deviceOs !== 'object') return ''
  const o = deviceOs as { os_type?: unknown; distribution?: unknown }
  if (typeof o.distribution === 'string' && o.distribution) return o.distribution
  if (typeof o.os_type === 'string' && o.os_type) return o.os_type
  return ''
}

export function relativeTime(iso: string, now: Date, locale: 'zh-CN' | 'en'): string {
  const t = new Date(iso).getTime()
  const diff = Math.max(0, now.getTime() - (Number.isNaN(t) ? now.getTime() : t))
  const min = Math.floor(diff / 60_000)
  const zh = locale === 'zh-CN'
  if (min < 1) return zh ? '刚刚' : 'just now'
  if (min < 60) return zh ? `${min} 分钟前` : `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return zh ? `${h} 小时前` : `${h} h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return zh ? `${d} 天前` : `${d} ${d === 1 ? 'day' : 'days'} ago`
  const w = Math.floor(d / 7)
  return zh ? `${w} 周前` : `${w} ${w === 1 ? 'week' : 'weeks'} ago`
}

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = Math.max(0, Number(n) || 0)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')
  return `${s} ${units[i]}`
}

export function locationText(g: GeoText | null | undefined): string | null {
  if (!g) return null
  return g.city || g.region || g.country || null
}
