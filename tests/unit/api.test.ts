import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToUuid } from '../../src/lib/uuid'
import { apiUrl, onUnauthorized, ApiError } from '../../src/api/http'
import {
  login, nodeRoutes, deleteMachine, nodeInfo, logout, checkLogin, proxyRpc, RPC_TIMEOUT_MS,
  setMachineAlias, unblockDevice, listMembers, updateMember, getMemberConfig,
  listInstances, instanceMetas, instanceInfo, getInstanceConfig, saveInstanceConfig, runInstance,
  setInstanceDisabled, deleteInstance, vpnPortalInfo, patchVpnPortalClients, generateToml, parseToml,
  TOML_EMPTY_ANSWER,
} from '../../src/api/client'
import instancesFx from '../fixtures/v2.7.1/instances-core2.json'
import metasFx from '../fixtures/v2.7.1/instance-metas-core2.json'
import instConfigFx from '../fixtures/v2.7.1/instance-config-core2.json'
import instInfoFx from '../fixtures/v2.7.1/instance-info-core2.json'
import instInfoDisabledFx from '../fixtures/v2.7.1/instance-info-disabled.json'
import parseOkFx from '../fixtures/v2.7.1/parse-config-ok.json'
import parseErrFx from '../fixtures/v2.7.1/parse-config-error.json'
import generateOkFx from '../fixtures/v2.7.1/generate-config-ok.json'
import vpnFx from '../fixtures/v2.7.1/vpn-portal-info-core2.json'

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

  describe('instances, toml and vpn portal', () => {
    const FIXED = '5eed0000-0000-4000-8000-000000000001'
    const path = (i: number) => calls[i].url.replace(/^.*\/api\/v1/, '')
    const body = (i: number) => JSON.parse(calls[i].init.body as string)

    it('listInstances converts UUID objects to strings', async () => {
      stub(() => json(instancesFx))
      const r = await listInstances('m/1')
      expect(calls[0].init.method).toBe('GET')
      expect(path(0)).toBe('/machines/m%2F1/networks')
      expect(r.running).toContain(FIXED)
      expect(r.running).toHaveLength(2)
      expect(r.disabled).toEqual([])
    })

    it('instanceMetas posts ids, maps source and permission; empty ids sends nothing', async () => {
      stub(() => json(metasFx))
      expect(await instanceMetas('m', [])).toEqual({})
      expect(calls).toHaveLength(0)
      const r = await instanceMetas('m', [FIXED])
      expect(calls[0].init.method).toBe('POST')
      expect(path(0)).toBe('/machines/m/networks/metas')
      expect(body(0)).toEqual({ instance_ids: [FIXED] })
      expect(r[FIXED]).toEqual({ networkName: 'lab-manual', instanceName: 'lab-manual', source: 'web', permission: 0 })
      stub(() => json({ metas: {
        a: { network_name: 'n', instance_name: 'i', source: 'ConfigSourceUser', config_permission: 3 },
        b: { network_name: 'n', instance_name: 'i', source: 1 },
        c: { network_name: 'n', instance_name: 'i', source: 2 },
        d: { network_name: 'n', instance_name: 'i', source: 'ConfigSourceUnspecified' },
        e: { network_name: 'n', instance_name: 'i' },
      } }))
      const m = await instanceMetas('m', ['a', 'b', 'c', 'd', 'e'])
      expect(Object.values(m).map((x) => x.source)).toEqual(['user', 'user', 'web', 'unspecified', 'unspecified'])
      expect(m.a.permission).toBe(3)
    })

    it('instanceInfo returns the entry, or null when disabled / missing', async () => {
      stub(() => json(instInfoFx))
      const r = await instanceInfo('m', FIXED)
      expect(path(0)).toBe('/machines/m/networks/info/' + FIXED)
      expect(r?.running).toBe(true)
      expect(r?.my_node_info?.virtual_ipv4?.address?.addr).toBe(173539331)
      stub(() => json(instInfoDisabledFx))
      expect(await instanceInfo('m', FIXED)).toBeNull()
    })

    it('instance config read / save / run / toggle / delete', async () => {
      stub(() => json(instConfigFx))
      expect(await getInstanceConfig('m', FIXED)).toEqual(instConfigFx)
      expect(calls[0].init.method).toBe('GET')
      expect(path(0)).toBe(`/machines/m/networks/config/${FIXED}`)
      stub(() => new Response(null, { status: 204 }))
      await saveInstanceConfig('m', 'a/b', { x: 1 })
      await runInstance('m', { y: 2 }, true)
      await setInstanceDisabled('m', 'a/b', true)
      await deleteInstance('m', 'a/b')
      expect(calls.map((c) => c.init.method)).toEqual(['PUT', 'POST', 'PUT', 'DELETE'])
      expect([0, 1, 2, 3].map(path)).toEqual([
        '/machines/m/networks/config/a%2Fb', '/machines/m/networks', '/machines/m/networks/a%2Fb', '/machines/m/networks/a%2Fb',
      ])
      expect(body(0)).toEqual({ config: { x: 1 } })
      expect(body(1)).toEqual({ config: { y: 2 }, save: true })
      expect(body(2)).toEqual({ disabled: true })
      expect(calls[3].init.body).toBeUndefined()
    })

    it('vpnPortalInfo goes through proxy-rpc with the instance id', async () => {
      stub(() => json(vpnFx))
      const r = await vpnPortalInfo('m', FIXED)
      expect(calls[0].init.method).toBe('POST')
      expect(path(0)).toBe('/machines/m/proxy-rpc')
      expect(body(0)).toEqual({
        service_name: 'api.instance.VpnPortalRpcService',
        method_name: 'get_vpn_portal_info',
        payload: { instance: { id: strToUuid(FIXED) } },
      })
      expect(r?.vpn_type).toBe('wireguard')
      expect(r?.client_config).toContain('[Interface]')
      expect(r?.clients).toEqual([])
      stub(() => json({}))
      expect(await vpnPortalInfo('m', FIXED)).toBeNull()
    })

    it('patchVpnPortalClients patches the vpn-portal-clients path', async () => {
      stub(() => new Response(null, { status: 204 }))
      const patches = [{ action: 'CLEAR' as const }]
      await patchVpnPortalClients('m', 'a/b', patches)
      expect(calls[0].init.method).toBe('PATCH')
      expect(path(0)).toBe('/machines/m/networks/a%2Fb/vpn-portal-clients')
      expect(body(0)).toEqual({ patches })
    })

    it('generateToml returns toml, or { error } on a 200 with error', async () => {
      stub(() => json(generateOkFx))
      const r = await generateToml({ network_name: 'x' })
      expect(calls[0].init.method).toBe('POST')
      expect(path(0)).toBe('/generate-config')
      expect(body(0)).toEqual({ config: { network_name: 'x' } })
      expect(r).toEqual({ toml: generateOkFx.toml_config })
      stub(() => json({ error: 'bad', toml_config: null }))
      expect(await generateToml({})).toEqual({ error: 'bad' })
      stub(() => json({ message: 'boom' }, 500))
      await expect(generateToml({})).rejects.toBeInstanceOf(ApiError)
    })

    it('parseToml returns the config, or { error } for the error fixture', async () => {
      stub(() => json(parseOkFx))
      const ok = await parseToml('a = 1')
      expect(path(0)).toBe('/parse-config')
      expect(body(0)).toEqual({ toml_config: 'a = 1' })
      expect(ok).toEqual({ config: parseOkFx.config })
      stub(() => json(parseErrFx))
      expect(await parseToml('network_name = [')).toEqual({ error: parseErrFx.error })
      stub(() => json({ message: 'boom' }, 500))
      await expect(parseToml('x')).rejects.toBeInstanceOf(ApiError)
    })

    // F7: read as `{}` / '', such an answer became an almost empty draft whose save wiped the config.
    it('generateToml: a 2xx answer with neither an error nor a TOML is an error', async () => {
      for (const answer of [{ error: null, toml_config: null }, { error: '' }, {}]) {
        stub(() => json(answer))
        expect(await generateToml({ network_name: 'x' }), JSON.stringify(answer)).toEqual({ error: TOML_EMPTY_ANSWER })
      }
      stub(() => new Response(null, { status: 200 }))
      expect(await generateToml({})).toEqual({ error: TOML_EMPTY_ANSWER })
      stub(() => new Response(null, { status: 204 }))
      expect(await generateToml({})).toEqual({ error: TOML_EMPTY_ANSWER })
    })

    it('parseToml: a 2xx answer with neither an error nor a config is an error', async () => {
      for (const answer of [{ error: null, config: null }, { error: '', config: null }, {}, { config: 'x' }, { config: [] }]) {
        stub(() => json(answer))
        expect(await parseToml('a = 1'), JSON.stringify(answer)).toEqual({ error: TOML_EMPTY_ANSWER })
      }
      stub(() => new Response(null, { status: 200 }))
      expect(await parseToml('a = 1')).toEqual({ error: TOML_EMPTY_ANSWER })
      stub(() => new Response(null, { status: 204 }))
      expect(await parseToml('a = 1')).toEqual({ error: TOML_EMPTY_ANSWER })
      // An error and a non-2xx answer are as before.
      stub(() => json({ error: 'bad', config: null }))
      expect(await parseToml('a = 1')).toEqual({ error: 'bad' })
      stub(() => json({ message: 'boom' }, 500))
      await expect(parseToml('a = 1')).rejects.toBeInstanceOf(ApiError)
    })
  })
})
