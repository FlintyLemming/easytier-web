import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import UiButton from '../../src/components/ui/UiButton.vue'
import CopyButton from '../../src/components/ui/CopyButton.vue'
import ConfirmHost from '../../src/components/ui/ConfirmHost.vue'
import { useConfirm } from '../../src/composables/useConfirm'

const flush = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ui components', () => {
  it('primary button uses brand background', () => {
    const w = mount(UiButton, { props: { variant: 'primary' }, slots: { default: 'Go' } })
    expect(w.classes().join(' ')).toContain('bg-primary')
    expect(w.attributes('type')).toBe('button')
  })

  it('loading button is disabled and busy', () => {
    const w = mount(UiButton, { props: { loading: true } })
    expect(w.attributes('disabled')).toBeDefined()
    expect(w.attributes('aria-busy')).toBe('true')
  })

  it('confirm resolves true/false', async () => {
    const host = mount(ConfirmHost, { attachTo: document.body })
    const { confirm } = useConfirm()

    const p1 = confirm({ title: 'Delete?', danger: true, confirmLabel: 'Delete' })
    await flush()
    const ok = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete')!
    ok.click()
    expect(await p1).toBe(true)
    await flush()

    const p2 = confirm({ title: 'Again?' })
    await flush()
    const cancel = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel')!
    cancel.click()
    expect(await p2).toBe(false)
    host.unmount()
  })

  it('CopyButton writes clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mount(CopyButton, { props: { text: '10.144.144.1' } })
    await w.trigger('click')
    expect(writeText).toHaveBeenCalledWith('10.144.144.1')
  })

  it('no component uses shadow', () => {
    const files = import.meta.glob('../../src/components/ui/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const entries = Object.entries(files)
    expect(entries.length).toBeGreaterThan(0)
    for (const [name, text] of entries) {
      expect(text.toLowerCase(), name).not.toContain('shadow')
    }
  })
})
