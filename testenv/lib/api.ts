import { createHash } from 'node:crypto'

export class EtApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string, where = '') {
    super(`HTTP ${status}${where ? ` ${where}` : ''}: ${body.slice(0, 300)}`)
    this.name = 'EtApiError'
    this.status = status
    this.body = body
  }
}

export interface EtApiOptions {
  // Per-request timeout covering the response headers and body. Default 15s.
  timeoutMs?: number
}

export class EtApi {
  base: string
  timeoutMs: number
  private cookies = new Map<string, string>()

  constructor(base = 'http://localhost:11211', opts: EtApiOptions = {}) {
    this.base = base.replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? 15_000
  }

  async login(user: string, pass: string): Promise<void> {
    const password = createHash('md5').update(pass).digest('hex')
    await this.post('/auth/login', { username: user, password })
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }
  del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    }
    // The signal also aborts reading the body, so a stalled response cannot hang a caller.
    // A timeout surfaces as a plain Error; waitFor treats it like any other failed attempt.
    const where = `${method} ${path}`
    const timedOut = (e: unknown) => {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        return new Error(`timeout after ${this.timeoutMs}ms: ${where}`, { cause: e })
      }
      return e
    }
    let res: Response
    let text: string
    try {
      res = await fetch(`${this.base}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';')
        const i = pair!.indexOf('=')
        if (i > 0) this.cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim())
      }
      text = await res.text()
    } catch (e) {
      throw timedOut(e)
    }
    if (!res.ok) throw new EtApiError(res.status, text, where)
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  for (;;) {
    try {
      const v = await fn()
      if (v !== undefined) return v
    } catch (e) {
      lastErr = e
    }
    if (Date.now() >= deadline) {
      const extra = lastErr instanceof Error ? ` (last error: ${lastErr.message})` : ''
      throw new Error(`timeout waiting for ${label}${extra}`)
    }
    await sleep(Math.min(2000, Math.max(0, deadline - Date.now())))
  }
}

export async function waitForApi(api: EtApi, timeoutMs = 60_000): Promise<void> {
  await waitFor(
    async () => {
      try {
        await api.get('/auth/check_login_status')
        return true
      } catch (e) {
        if (e instanceof EtApiError && e.status === 401) return true
        return undefined
      }
    },
    timeoutMs,
    'easytier-web API',
  )
}

export const MACHINES = {
  core1: '11111111-1111-4111-8111-111111111111',
  core2: '22222222-2222-4222-8222-222222222222',
  core3: '33333333-3333-4333-8333-333333333333',
} as const

export interface UuidParts {
  part1: number
  part2: number
  part3: number
  part4: number
}

export function uuidToStr(u: UuidParts): string {
  const h = [u.part1, u.part2, u.part3, u.part4].map((p) => (p >>> 0).toString(16).padStart(8, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function strToUuid(s: string): UuidParts {
  const h = s.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(h)) throw new Error(`invalid uuid: ${s}`)
  const p = (i: number) => parseInt(h.slice(i * 8, i * 8 + 8), 16)
  return { part1: p(0), part2: p(1), part3: p(2), part4: p(3) }
}
