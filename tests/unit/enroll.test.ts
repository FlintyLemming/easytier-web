import { afterEach, describe, expect, it } from 'vitest'
import { enrollCommand, enrollEndpoint } from '../../src/lib/enroll'
import type { ConsoleInfo } from '../../src/api/types'

const base: ConsoleInfo = {
  username: 'admin',
  config_server_protocol: 'udp',
  config_server_port: 22020,
  webhook_auth: false,
}

afterEach(() => {
  window.__ET_CONFIG__ = undefined
})

describe('enroll', () => {
  const host = window.location.hostname

  it('uses the browser host and config_server_port when config_server_host is empty', () => {
    expect(enrollEndpoint(base)).toBe(`udp://${host}:22020`)
    expect(enrollEndpoint({ ...base, config_server_host: '' })).toBe(`udp://${host}:22020`)
    expect(enrollEndpoint({ ...base, config_server_host: null })).toBe(`udp://${host}:22020`)
  })

  it('derives the host from apiBase when configured', () => {
    window.__ET_CONFIG__ = { apiBase: 'http://api.example.org:8080' }
    expect(enrollEndpoint(base)).toBe('udp://api.example.org:22020')
  })

  it('keeps an explicit port in config_server_host', () => {
    expect(enrollEndpoint({ ...base, config_server_host: 'et.example.com:443' })).toBe('udp://et.example.com:443')
  })

  it('appends the port to a bare configured host', () => {
    expect(enrollEndpoint({ ...base, config_server_host: 'et.example.com' })).toBe('udp://et.example.com:22020')
  })

  it('uses the protocol from a scheme-prefixed config_server_host', () => {
    expect(enrollEndpoint({ ...base, config_server_host: 'tcp://h' })).toBe('tcp://h:22020')
    expect(enrollEndpoint({ ...base, config_server_host: 'tcp://h:1' })).toBe('tcp://h:1')
  })

  it('builds the easytier-core command', () => {
    expect(enrollCommand({ ...base, config_server_host: 'h' })).toBe('easytier-core --config-server udp://h:22020/admin')
  })
})
