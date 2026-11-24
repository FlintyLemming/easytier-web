import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page, Request } from '@playwright/test'

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/v2.7.1/', import.meta.url))

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(FIXTURE_DIR + name, 'utf8')) as T
}

/** Return this from an override to answer with a specific HTTP status. */
export class MockStatus {
  constructor(
    public status: number,
    public body: unknown = {},
  ) {}
}
export const status = (code: number, body: unknown = {}) => new MockStatus(code, body)

export type Overrides = Record<string, (req: Request) => unknown | Promise<unknown>>

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const RPC_FIXTURES: Record<string, string> = {
  list_route: 'list-route-core1.json',
  list_peer: 'list-peer-core1.json',
  show_node_info: 'show-node-info-core3.json',
  get_logger_config: 'logger-level.json',
}

type Route = [RegExp, string]
const GET_ROUTES: Route[] = [
  [/^\/console-info$/, 'console-info.json'],
  [/^\/summary$/, 'summary.json'],
  [/^\/machines$/, 'machines.json'],
  [/^\/networks$/, 'networks.json'],
  [/^\/networks\/gateway-info$/, 'gateway-info.json'],
  [/^\/networks\/[^/]+$/, 'network.json'],
  [/^\/networks\/[^/]+\/members$/, 'members.json'],
  [/^\/networks\/[^/]+\/members\/[^/]+\/config$/, 'member-config-core3.json'],
  [/^\/networks\/[^/]+\/acl-policy$/, 'acl-policy.json'],
  [/^\/networks\/[^/]+\/credentials$/, 'credentials.json'],
  [/^\/blocked-devices$/, 'blocked-devices.json'],
]

const AUTH_DEFAULTS: Record<string, unknown> = {
  'GET /auth/check_login_status': {},
  'POST /auth/login': {},
  'GET /auth/logout': {},
  'GET /auth/oidc/config': { enabled: false },
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^?]*')
  return new RegExp('^' + esc + '$')
}

/**
 * Webhook mode as upstream v2.7.1 serves it: console-info says `webhook_auth: true`; the central
 * `/networks*` routes are not registered (bare 404); `/machines` lists sessions without `networks`
 * or `alias`; alias/delete act on the central device registry, which webhook mode never fills (404).
 */
function webhookMachines() {
  const base = fixture('machines.json')
  for (const m of base.machines) {
    m.networks = []
    m.alias = null
  }
  return base
}

export interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

/**
 * Intercept `**\/api/v1/**`. `overrides` is read live on every request (keys: `'METHOD /path'`,
 * `*` wildcard), so tests may mutate it mid-run. Handlers return JSON data or `status(code, body)`.
 * Also pins `localStorage['et.locale']` (default zh-CN) for deterministic text.
 * `opts.webhook` serves the backend in webhook mode (see `webhookMachines`); overrides still win.
 */
export async function mockApi(
  page: Page,
  overrides: Overrides = {},
  opts: { locale?: 'zh-CN' | 'en'; webhook?: boolean } = {},
): Promise<{ requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = []
  const locale = opts.locale ?? 'zh-CN'
  await page.addInitScript((l) => {
    try {
      if (!localStorage.getItem('et.locale')) localStorage.setItem('et.locale', l)
    } catch { /* ignore */ }
  }, locale)

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/api\/v1/, '')
    const method = req.method()
    let body: unknown
    const raw = req.postData()
    if (raw) {
      try { body = JSON.parse(raw) } catch { body = raw }
    }
    requests.push({ method, path, body })

    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) })

    const key = `${method} ${path}`
    for (const [pattern, handler] of Object.entries(overrides)) {
      const [m, p] = pattern.split(' ')
      if (m === method && globToRegExp(p!).test(path)) {
        const out = await handler(req)
        return out instanceof MockStatus ? json(out.body, out.status) : json(out)
      }
    }
    if (opts.webhook) {
      if (key === 'GET /console-info') return json({ ...fixture<object>('console-info.json'), webhook_auth: true })
      if (/^\/networks(\/|$)/.test(path)) return route.fulfill({ status: 404, body: '' })
      if (key === 'GET /machines') return json(webhookMachines())
      if (
        (method === 'DELETE' && /^\/machines\/[^/]+$/.test(path)) ||
        (method === 'PUT' && /^\/machines\/[^/]+\/alias$/.test(path))
      ) {
        return json({ error: 'device not found' }, 404)
      }
    }
    if (key === 'GET /auth/captcha') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (key in AUTH_DEFAULTS) return json(AUTH_DEFAULTS[key])
    if (method === 'GET') {
      const hit = GET_ROUTES.find(([re]) => re.test(path))
      if (hit) return json(fixture(hit[1]))
    }
    if (method === 'POST' && /^\/machines\/[^/]+\/proxy-rpc$/.test(path)) {
      const name = (body as { method_name?: string } | undefined)?.method_name ?? ''
      const file = RPC_FIXTURES[name]
      return json(file ? fixture(file) : {})
    }
    if (method !== 'GET') return json({})
    return json({ message: `no mock for ${key}` }, 404)
  })

  return { requests }
}
