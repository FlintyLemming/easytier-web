import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EtApi, EtApiError, waitFor, uuidToStr, strToUuid } from './api.ts'

async function withServer(
  handler: (req: IncomingMessage, body: string) => { status: number; headers?: Record<string, string>; body?: string },
  fn: (base: string) => Promise<void>,
) {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const r = handler(req, body)
      res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers })
      res.end(r.body ?? '{}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    server.close()
  }
}

test('login posts md5 password and stores cookie', async () => {
  const seen: { url?: string; body?: string; cookie?: string | undefined }[] = []
  await withServer(
    (req, body) => {
      seen.push({ url: req.url, body, cookie: req.headers.cookie })
      if (req.url === '/api/v1/auth/login') {
        return { status: 200, headers: { 'set-cookie': 'session=abc123; Path=/; HttpOnly' } }
      }
      return { status: 200, body: '{"ok":true}' }
    },
    async (base) => {
      const api = new EtApi(base)
      await api.login('admin', 'admin')
      assert.equal(seen[0]!.url, '/api/v1/auth/login')
      assert.equal(seen[0]!.body, '{"username":"admin","password":"21232f297a57a5a743894a0e4a801fc3"}')
      const r = await api.get<{ ok: boolean }>('/machines')
      assert.equal(r.ok, true)
      assert.equal(seen[1]!.url, '/api/v1/machines')
      assert.match(seen[1]!.cookie ?? '', /session=abc123/)
    },
  )
})

test('non-2xx throws EtApiError with status', async () => {
  await withServer(
    () => ({ status: 409, body: 'conflict' }),
    async (base) => {
      const api = new EtApi(base)
      await assert.rejects(api.post('/x', {}), (e: unknown) => {
        assert.ok(e instanceof EtApiError)
        assert.equal(e.status, 409)
        assert.equal(e.body, 'conflict')
        return true
      })
    },
  )
})

test('waitFor times out with label', async () => {
  await assert.rejects(waitFor(async () => undefined, 50, 'my-label'), /my-label/)
})

test('waitFor returns first defined value', async () => {
  assert.equal(await waitFor(async () => 7, 1000, 'x'), 7)
})

test('uuid conversion round trips', () => {
  const s = '11111111-1111-4111-8111-111111111111'
  const u = strToUuid(s)
  assert.deepEqual(u, { part1: 0x11111111, part2: 0x11114111, part3: 0x81111111, part4: 0x11111111 })
  assert.equal(uuidToStr(u), s)
})

// A server that accepts requests and never answers (or answers headers but never ends the body).
async function withHangingServer(mode: 'no-response' | 'no-body-end', fn: (base: string, hits: () => number) => Promise<void>) {
  let n = 0
  const server = createServer((_req, res) => {
    n++
    if (mode === 'no-body-end') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"partial":')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, () => n)
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

test('request times out with a clear error when the server never responds', async () => {
  await withHangingServer('no-response', async (base) => {
    const api = new EtApi(base, { timeoutMs: 150 })
    const t0 = Date.now()
    await assert.rejects(api.get('/machines'), /timeout after 150ms: GET \/machines/)
    assert.ok(Date.now() - t0 < 2000, 'gave up promptly')
  })
})

test('request times out when the body never finishes', async () => {
  await withHangingServer('no-body-end', async (base) => {
    const api = new EtApi(base, { timeoutMs: 150 })
    await assert.rejects(api.post('/x', {}), /timeout after 150ms: POST \/x/)
  })
})

test('waitFor keeps polling a timing-out request until its own deadline', async () => {
  await withHangingServer('no-response', async (base, hits) => {
    const api = new EtApi(base, { timeoutMs: 100 })
    await assert.rejects(waitFor(() => api.get('/machines'), 600, 'hung api'), (e: unknown) => {
      assert.match(String(e), /timeout waiting for hung api \(last error: timeout after 100ms: GET \/machines\)/)
      return true
    })
    assert.ok(hits() >= 2, `polled ${hits()} times`)
  })
})

test('default request timeout is 15s', () => {
  assert.equal(new EtApi().timeoutMs, 15_000)
})
