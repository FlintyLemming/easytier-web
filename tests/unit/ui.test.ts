import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UiButton from '../../src/components/ui/UiButton.vue'
import CopyButton from '../../src/components/ui/CopyButton.vue'
import ConfirmHost from '../../src/components/ui/ConfirmHost.vue'
import ToastHost from '../../src/components/ui/ToastHost.vue'
import { useConfirm } from '../../src/composables/useConfirm'
import { toasts, useToast } from '../../src/composables/useToast'

const wrappers: VueWrapper[] = []
function track<T extends VueWrapper>(w: T): T {
  wrappers.push(w)
  return w
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  while (wrappers.length) wrappers.pop()!.unmount()
  toasts.splice(0)
})

const btn = (label: string) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

describe('UiButton', () => {
  it('primary button uses brand background', () => {
    const w = track(mount(UiButton, { props: { variant: 'primary' }, slots: { default: 'Go' } }))
    expect(w.classes().join(' ')).toContain('bg-primary')
    expect(w.attributes('type')).toBe('button')
  })

  it('loading button is disabled and busy', () => {
    const w = track(mount(UiButton, { props: { loading: true } }))
    expect(w.attributes('disabled')).toBeDefined()
    expect(w.attributes('aria-busy')).toBe('true')
  })
})

describe('confirm', () => {
  it('resolves true on confirm and false on cancel', async () => {
    track(mount(ConfirmHost, { attachTo: document.body }))
    const { confirm } = useConfirm()

    const p1 = confirm({ title: 'Delete?', danger: true, confirmLabel: 'Delete' })
    await flushPromises()
    btn('Delete')!.click()
    expect(await p1).toBe(true)
    await flushPromises()

    const p2 = confirm({ title: 'Again?' })
    await flushPromises()
    btn('Cancel')!.click()
    expect(await p2).toBe(false)
  })

  it('handles two concurrent confirms with the same title, each settling once', async () => {
    track(mount(ConfirmHost, { attachTo: document.body }))
    const { confirm } = useConfirm()
    const r1 = vi.fn()
    const r2 = vi.fn()
    const p1 = confirm({ title: 'Same', confirmLabel: 'First' }).then(r1)
    const p2 = confirm({ title: 'Same', confirmLabel: 'Second' }).then(r2)
    await flushPromises()

    expect(btn('First')).toBeDefined()
    expect(btn('Second')).toBeUndefined()
    btn('First')!.click()
    await p1
    await flushPromises()
    expect(r1).toHaveBeenCalledExactlyOnceWith(true)
    expect(r2).not.toHaveBeenCalled()

    expect(btn('Second')).toBeDefined()
    btn('Cancel')!.click()
    await p2
    await flushPromises()
    expect(r2).toHaveBeenCalledExactlyOnceWith(false)
    expect(r1).toHaveBeenCalledTimes(1)
  })

  it('Esc dismissal resolves false', async () => {
    track(mount(ConfirmHost, { attachTo: document.body }))
    const p = useConfirm().confirm({ title: 'Esc?' })
    await flushPromises()
    document.body.querySelector('[role="dialog"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(await p).toBe(false)
  })
})

describe('CopyButton', () => {
  it('writes clipboard, shows check for 1500 ms, default aria-label', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const w = track(mount(CopyButton, { props: { text: '10.144.144.1' } }))
    expect(w.attributes('aria-label')).toBe('Copy')
    expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(false)

    await w.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('10.144.144.1')
    expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(1499)
    expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(false)
  })

  it('rejected clipboard write shows no check and does not throw', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const w = track(mount(CopyButton, { props: { text: 'x', label: 'Copy IP' } }))
    expect(w.attributes('aria-label')).toBe('Copy IP')
    await w.trigger('click')
    await flushPromises()
    expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(false)
  })
})

describe('toasts', () => {
  it('auto-dismisses success at 3000 ms and error at 5000 ms with proper roles', async () => {
    vi.useFakeTimers()
    const w = track(mount(ToastHost))
    const t = useToast()
    t.success('ok')
    t.error('bad')
    await flushPromises()
    expect(w.find('[role="status"]').text()).toContain('ok')
    expect(w.find('[role="alert"]').text()).toContain('bad')

    await vi.advanceTimersByTimeAsync(2999)
    expect(toasts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(toasts.map((x) => x.message)).toEqual(['bad'])
    await vi.advanceTimersByTimeAsync(1999)
    expect(toasts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(toasts).toHaveLength(0)
  })

  it('manual dismiss clears the pending timer', async () => {
    vi.useFakeTimers()
    const w = track(mount(ToastHost))
    useToast().success('hi')
    await flushPromises()
    expect(vi.getTimerCount()).toBe(1)
    await w.find('button[aria-label="Dismiss"]').trigger('click')
    expect(toasts).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('design constraints', () => {
  it('no component uses shadow', () => {
    const files = import.meta.glob('../../src/components/ui/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const entries = Object.entries(files)
    expect(entries.length).toBeGreaterThan(0)
    for (const [name, text] of entries) {
      expect(text.toLowerCase(), name).not.toContain('shadow')
    }
  })
})
