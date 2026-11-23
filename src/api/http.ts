export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

let unauthorizedHandler: (() => void) | undefined

/** Register the single 401 handler (latest registration wins). */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

export function apiUrl(path: string): string {
  const base = (window.__ET_CONFIG__?.apiBase ?? '').replace(/\/+$/, '')
  return base + '/api/v1' + path
}

export async function request<T>(
  method: Method,
  path: string,
  opts: { body?: unknown; query?: Record<string, string | boolean> } = {},
): Promise<T> {
  let url = apiUrl(path)
  if (opts.query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query)) qs.set(k, String(v))
    const s = qs.toString()
    if (s) url += '?' + s
  }
  const init: RequestInit = { method, credentials: 'include' }
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch(url, init)
  const text = await res.text()
  let parsed: unknown = text
  let isJson = false
  if (text) {
    try {
      parsed = JSON.parse(text)
      isJson = true
    } catch {
      parsed = text
    }
  }
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.()
    const msg =
      isJson && parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string'
        ? (parsed as { message: string }).message
        : text || res.statusText || `HTTP ${res.status}`
    throw new ApiError(res.status, isJson ? parsed : text || undefined, msg)
  }
  if (res.status === 204 || !text) return undefined as T
  return parsed as T
}
