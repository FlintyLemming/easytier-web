// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later
// (derived from the enroll-command logic in easytier-web/frontend MainPage.vue / DeviceList.vue)
import { apiUrl } from '../api/http'
import type { ConsoleInfo } from '../api/types'

/**
 * `config_server_host` (newer servers) may be empty, `host`, `host:port`, `scheme://host`
 * or `scheme://host:port`. Missing parts fall back to the browser-side API host, the
 * advertised protocol and `config_server_port`.
 */
export function enrollEndpoint(info: ConsoleInfo): string {
  let proto = info.config_server_protocol
  let hostPort = (info.config_server_host ?? '').trim()
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(hostPort)
  if (scheme) {
    proto = scheme[1]!.toLowerCase()
    hostPort = hostPort.slice(scheme[0].length)
  }
  hostPort = hostPort.replace(/\/+$/, '')
  if (!hostPort) hostPort = new URL(apiUrl('/'), window.location.href).hostname
  const hasPort = /^\[[^\]]*\]:\d+$/.test(hostPort) || /^[^:[\]]+:\d+$/.test(hostPort)
  if (!hasPort) hostPort += `:${info.config_server_port}`
  return `${proto}://${hostPort}`
}

export function enrollCommand(info: ConsoleInfo): string {
  return `easytier-core --config-server ${enrollEndpoint(info)}/${info.username}`
}
