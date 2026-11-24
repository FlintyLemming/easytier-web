import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePolling } from '../../src/composables/usePolling'

function setHidden(v: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })
}

beforeEach(() => { vi.useFakeTimers(); setHidden(false) })
afterEach(() => { vi.useRealTimers(); setHidden(false) })

describe('usePolling', () => {
  it('runs immediately then every interval', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const p = usePolling(fn, 1000)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fn).toHaveBeenCalledTimes(3)
    p.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('pauses when hidden', async () => {
    setHidden(true)
    const fn = vi.fn().mockResolvedValue(undefined)
    const p = usePolling(fn, 1000)
    p.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fn).toHaveBeenCalledTimes(0)
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
    p.stop()
  })

  it('does not overlap and survives errors', async () => {
    let resolve!: () => void
    const fn = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { resolve = r }))
      .mockRejectedValue(new Error('x'))
    const p = usePolling(fn, 1000)
    p.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(3)
    p.stop()
  })
})

describe('usePolling with an interval getter', () => {
  it('re-reads the interval each time it schedules the next run', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const getter = vi.fn().mockReturnValueOnce(1000).mockReturnValue(3000)
    const p = usePolling(fn, getter)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000) // first wait used 1000
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2999)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(3)
    p.stop()
  })
})
