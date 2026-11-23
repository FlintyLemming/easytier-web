import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToUuid } from '../../src/lib/uuid'
import { apiUrl, onUnauthorized, ApiError } from '../../src/api/http'
import { login, nodeRoutes, deleteMachine, nodeInfo, logout, checkLogin } from '../../src/api/client'

interface Call { url: string; init: RequestInit }
let calls: Call[]
function stub(respond: (c: Call) => Response) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const c = { url, init }
    calls.push(c)
    return respond(c)
  }))
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  window.__ET_CONFIG__ = undefined
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('login sends md5 password', async () => {
    stub(() => json({}))
    await login('admin', 'admin')
    expect(calls[0].url.endsWith('/api/v1/auth/login')).toBe(true)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.credentials).toBe('include')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      username: 'admin',
      password: '21232f297a57a5a743894a0e4a801fc3',
    })
  })

  it('apiBase from window config', () => {
    window.__ET_CONFIG__ = { apiBase: 'https://api.example.com/' }
    expect(apiUrl('/machines')).toBe('https://api.example.com/api/v1/machines')
  })

  it('401 calls unauthorized handler and throws ApiError', async () => {
    stub(() => json({ message: 'nope' }, 401))
    const h = vi.fn()
    onUnauthorized(h)
    const err = await login('a', 'b').catch((e) => e)
    expect(h).toHaveBeenCalledTimes(1)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('nope')
  })

  it('logout tolerates 401, checkLogin returns false on 401', async () => {
    stub(() => json({}, 401))
    onUnauthorized(() => {})
    await expect(logout()).resolves.toBeUndefined()
    expect(await checkLogin()).toBe(false)
  })

  it('nodeRoutes wraps proxy-rpc', async () => {
    const net = '11111111-2222-3333-4444-555555555555'
    stub(() => json({}))
    const r = await nodeRoutes('m1', net)
    expect(r).toEqual([])
    expect(calls[0].url.endsWith('/machines/m1/proxy-rpc')).toBe(true)
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      service_name: 'api.instance.PeerManageRpcService',
      method_name: 'list_route',
      payload: { instance: { id: strToUuid(net) } },
    })
  })

  it('deleteMachine with block adds query', async () => {
    stub(() => new Response(null, { status: 204 }))
    await deleteMachine('abc', true)
    expect(calls[0].url.endsWith('/machines/abc?block=true')).toBe(true)
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('nodeInfo decodes interface ips', async () => {
    stub(() => json({ node_info: { config: 'x', ip_list: { interface_ipv4s: [{ addr: 3232235777 }] } } }))
    expect(await nodeInfo('m', '11111111-2222-3333-4444-555555555555')).toEqual({
      config: 'x',
      interfaceIpv4s: ['192.168.1.1'],
    })
  })
})
