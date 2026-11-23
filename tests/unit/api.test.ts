import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToUuid } from '../../src/lib/uuid'
import { apiUrl, onUnauthorized, ApiError } from '../../src/api/http'
import {
  login, nodeRoutes, deleteMachine, nodeInfo, logout, checkLogin, proxyRpc, RPC_TIMEOUT_MS,
  setMachineAlias, unblockDevice, listMembers, updateMember, getMemberConfig,
} from '../../src/api/client'

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

  it('proxy-rpc runs at most 4 requests at once and drains the queue', async () => {
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>((r) => release.push(r))
      inFlight--
      return json({ ok: true })
    }))
    const all = Promise.all(Array.from({ length: 6 }, (_, i) => proxyRpc(`m${i}`, 's', 'x', {})))
    await vi.waitFor(() => expect(calls).toHaveLength(4))
    expect(peak).toBe(4)
    release.shift()!()
    await vi.waitFor(() => expect(calls).toHaveLength(5))
    expect(peak).toBe(4)
    while (calls.length < 6 || release.length) {
      release.shift()?.()
      await new Promise((r) => setTimeout(r, 0))
    }
    await expect(all).resolves.toHaveLength(6)
    expect(peak).toBe(4)
  })

  it('a failed proxy-rpc frees its slot', async () => {
    stub(() => json({ message: 'nope' }, 500))
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => proxyRpc('m', 's', 'x', {})))
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    stub(() => json({ ok: true }))
    await expect(proxyRpc('m', 's', 'x', {})).resolves.toEqual({ ok: true })
  })

  it('a hung proxy-rpc times out after 8 s, frees its slot, and the next queued call runs', async () => {
    vi.useFakeTimers()
    try {
      calls = []
      // Never resolves and ignores the abort signal: the timeout alone must free the slot.
      vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Promise<Response>(() => {})
      }))
      const settled: PromiseSettledResult<unknown>[] = []
      const ps = Array.from({ length: 5 }, (_, i) =>
        proxyRpc(`m${i}`, 's', 'x', {}).then(
          (v) => { settled[i] = { status: 'fulfilled', value: v } },
          (e) => { settled[i] = { status: 'rejected', reason: e } },
        ),
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toHaveLength(4)
      expect(calls.every((c) => c.init.signal instanceof AbortSignal && !c.init.signal.aborted)).toBe(true)

      await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS - 1)
      expect(settled.filter(Boolean)).toHaveLength(0)
      expect(calls).toHaveLength(4)

      await vi.advanceTimersByTimeAsync(1)
      for (let i = 0; i < 4; i++) {
        const r = settled[i] as PromiseRejectedResult
        expect(r.status).toBe('rejected')
        expect(r.reason).toBeInstanceOf(ApiError)
        expect(r.reason.status).toBe(0)
        expect(r.reason.message).toBe('timeout')
        expect(calls[i]!.init.signal!.aborted).toBe(true)
      }
      // The queued fifth call got a freed slot.
      expect(calls).toHaveLength(5)
      expect(calls[4]!.url.endsWith('/machines/m4/proxy-rpc')).toBe(true)

      // Drain it so the module-level limiter is clean for other tests.
      await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS)
      await Promise.all(ps)
      expect(settled).toHaveLength(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a proxy-rpc answered in time clears its timeout timer', async () => {
    vi.useFakeTimers()
    try {
      stub(() => json({ ok: true }))
      await expect(proxyRpc('m', 's', 'x', {})).resolves.toEqual({ ok: true })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('encodes every interpolated path segment', async () => {
    stub(() => new Response(null, { status: 204 }))
    const odd = 'a/b c'
    const enc = 'a%2Fb%20c'
    await deleteMachine(odd, false)
    await setMachineAlias(odd, 'x')
    await unblockDevice(odd)
    await listMembers(odd)
    await updateMember(odd, odd, { hostname_override: 'h' })
    await getMemberConfig(odd, odd)
    await proxyRpc(odd, 's', 'x', {})
    const paths = calls.map((c) => c.url.replace(/^.*\/api\/v1/, ''))
    expect(paths).toEqual([
      `/machines/${enc}`,
      `/machines/${enc}/alias`,
      `/blocked-devices/${enc}`,
      `/networks/${enc}/members`,
      `/networks/${enc}/members/${enc}`,
      `/networks/${enc}/members/${enc}/config`,
      `/machines/${enc}/proxy-rpc`,
    ])
  })
})
