import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UiButton from '../../src/components/ui/UiButton.vue'
import CopyButton from '../../src/components/ui/CopyButton.vue'
import ConfirmHost from '../../src/components/ui/ConfirmHost.vue'
import ToastHost from '../../src/components/ui/ToastHost.vue'
import { useConfirm } from '../../src/composables/useConfirm'
import { toasts, useToast } from '../../src/composables/useToast'
import StatusDot from '../../src/components/ui/StatusDot.vue'
import KeyValueList from '../../src/components/ui/KeyValueList.vue'
import UiDialog from '../../src/components/ui/UiDialog.vue'
import { i18n } from '../../src/i18n'

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

  it('confirm button: danger variant for danger, secondary (never orange) otherwise', async () => {
    track(mount(ConfirmHost, { attachTo: document.body }))
    const { confirm } = useConfirm()
    const p1 = confirm({ title: 'Plain', confirmLabel: 'Go' })
    await flushPromises()
    const go = btn('Go')!
    expect(go.className).not.toContain('bg-primary')
    expect(go.className).toContain('border-hairline-strong')
    expect(go.className).toBe(btn('Cancel')!.className)
    go.click()
    await p1
    await flushPromises()

    const p2 = confirm({ title: 'Risky', confirmLabel: 'Remove', danger: true })
    await flushPromises()
    const rm = btn('Remove')!
    expect(rm.className).toContain('text-error')
    expect(rm.className).not.toContain('bg-primary')
    rm.click()
    expect(await p2).toBe(true)
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

  it('rejected clipboard write without a fallback shows no check and toasts 复制失败', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const w = track(mount(CopyButton, { props: { text: 'x', label: 'Copy IP' } }))
    expect(w.attributes('aria-label')).toBe('Copy IP')
    await w.trigger('click')
    await flushPromises()
    expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(false)
    expect(toasts.map((x) => [x.kind, x.message])).toEqual([['error', 'Copy failed']])
  })

  it('copies over plain HTTP through the execCommand fallback', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
    try {
      const w = track(mount(CopyButton, { props: { text: '10.144.144.1' } }))
      await w.trigger('click')
      await flushPromises()
      expect(exec).toHaveBeenCalledWith('copy')
      expect(w.find('path[d="M20 6 9 17l-5-5"]').exists()).toBe(true)
      expect(toasts).toHaveLength(0)
    } finally {
      delete (document as { execCommand?: unknown }).execCommand
    }
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

describe('UiDialog', () => {
  async function openDialog(size?: 'md' | 'lg' | 'wide') {
    track(mount(UiDialog, { props: { open: true, title: 'T', ...(size ? { size } : {}) }, slots: { default: '<p id="dlg-body">body</p>' }, attachTo: document.body }))
    await flushPromises()
    const content = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const body = document.getElementById('dlg-body')!.parentElement!
    return { content: content.className, body: body.className }
  }

  it('stays narrow with an unscrolled body by default', async () => {
    const { content, body } = await openDialog()
    expect(content).toContain('max-w-md')
    expect(body).not.toContain('overflow-y-auto')
  })

  it('size lg is wide and scrolls its body between title and footer', async () => {
    const { content, body } = await openDialog('lg')
    expect(content).toContain('max-w-3xl')
    expect(content).not.toContain('max-w-md')
    expect(body).toContain('overflow-y-auto')
  })

  it('size wide is as wide as lg but only as tall as its content, up to the viewport', async () => {
    const { content, body } = await openDialog('wide')
    expect(content).toContain('max-w-3xl')
    expect(content).toContain('max-h-[min(calc(100dvh-32px),960px)]')
    expect(content).not.toMatch(/(^|\s)h-\[/)
    expect(body).toContain('overflow-y-auto')
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

describe('screen-reader labels follow the locale', () => {
  afterEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('CopyButton, KeyValueList copy, toast dismiss and StatusDot are translated', async () => {
    i18n.global.locale.value = 'en'
    const copy = track(mount(CopyButton, { props: { text: 'x' } }))
    const dot = track(mount(StatusDot, { props: { online: true } }))
    const off = track(mount(StatusDot, { props: { online: false } }))
    const kv = track(mount(KeyValueList, { props: { items: [{ label: '内网 IP', value: '10.0.0.1', copy: true }] } }))
    const host = track(mount(ToastHost))
    useToast().success('ok')
    await flushPromises()
    expect(copy.attributes('aria-label')).toBe('Copy')
    expect(dot.attributes('aria-label')).toBe('Online')
    expect(off.attributes('aria-label')).toBe('Offline')
    expect(kv.find('button').attributes('aria-label')).toBe('Copy 内网 IP')
    expect(host.find('button').attributes('aria-label')).toBe('Dismiss')

    i18n.global.locale.value = 'zh-CN'
    await flushPromises()
    expect(copy.attributes('aria-label')).toBe('复制')
    expect(dot.attributes('aria-label')).toBe('在线')
    expect(off.attributes('aria-label')).toBe('离线')
    expect(kv.find('button').attributes('aria-label')).toBe('复制内网 IP')
    expect(host.find('button').attributes('aria-label')).toBe('关闭')
  })

  it('KeyValueList parts give each part its own font', () => {
    const w = track(mount(KeyValueList, {
      props: { items: [{ label: 'ip', value: '1.2.3.4 · 杭州', parts: [{ text: '1.2.3.4', mono: true }, { text: '杭州' }] }] },
    }))
    const spans = w.findAll('dd span span').filter((x) => x.text() !== '·')
    expect(spans.map((x) => [x.text(), x.classes().includes('font-mono')])).toEqual([['1.2.3.4', true], ['杭州', false]])
    expect(w.find('dd').classes()).not.toContain('font-mono')
  })
})

