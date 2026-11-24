import { getCurrentScope, onScopeDispose } from 'vue'

export function usePolling(fn: () => Promise<unknown>, intervalMs: number | (() => number)): { start(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let active = false
  let busy = false

  function clear() {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }
  function schedule() {
    clear()
    if (active) timer = setTimeout(tick, typeof intervalMs === 'function' ? intervalMs() : intervalMs)
  }
  async function tick() {
    timer = null
    if (!active) return
    if (document.hidden) { schedule(); return }
    if (busy) return
    busy = true
    try { await fn() } catch { /* keep polling */ } finally { busy = false }
    schedule()
  }
  function onVisibility() {
    if (active && !document.hidden && !busy) {
      clear()
      void tick()
    }
  }
  function start() {
    if (running) return
    running = true
    active = true
    document.addEventListener('visibilitychange', onVisibility)
    void tick()
  }
  function stop() {
    running = false
    active = false
    clear()
    document.removeEventListener('visibilitychange', onVisibility)
  }
  if (getCurrentScope()) onScopeDispose(stop)
  return { start, stop }
}
