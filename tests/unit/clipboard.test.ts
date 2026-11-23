import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../../src/lib/clipboard'

// jsdom implements neither navigator.clipboard nor document.execCommand; each test installs its own.
function stubExecCommand(result: boolean | 'throw') {
  const seen: { command: string; selected: string; inDom: boolean }[] = []
  const exec = vi.fn((command: string) => {
    const ta = document.querySelector('textarea')
    seen.push({
      command,
      selected: ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '',
      inDom: !!ta,
    })
    if (result === 'throw') throw new Error('nope')
    return result
  })
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
  return { exec, seen }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (document as { execCommand?: unknown }).execCommand
  document.body.innerHTML = ''
})

describe('copyText', () => {
  it('uses the async clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { exec } = stubExecCommand(true)
    expect(await copyText('10.144.144.1')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('10.144.144.1')
    expect(exec).not.toHaveBeenCalled()
  })

  it('falls back to a hidden textarea + execCommand on plain HTTP (no navigator.clipboard)', async () => {
    vi.stubGlobal('navigator', {})
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    const { seen } = stubExecCommand(true)
    expect(await copyText('udp://203.0.113.7:4000')).toBe(true)
    expect(seen).toEqual([{ command: 'copy', selected: 'udp://203.0.113.7:4000', inDom: true }])
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('falls back when the clipboard API rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const { exec } = stubExecCommand(true)
    expect(await copyText('x')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('resolves false when both paths fail', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    stubExecCommand(false)
    expect(await copyText('x')).toBe(false)
    stubExecCommand('throw')
    expect(await copyText('x')).toBe(false)
    delete (document as { execCommand?: unknown }).execCommand
    expect(await copyText('x')).toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('also puts the text on the copy event, so a focus trap cannot swap the selection', async () => {
    vi.stubGlobal('navigator', {})
    const setData = vi.fn()
    let prevented = false
    const exec = vi.fn(() => {
      // What a browser does: fire `copy` at the focused element (here not the textarea).
      const ev = new Event('copy', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clipboardData', { value: { setData } })
      document.body.dispatchEvent(ev)
      prevented = ev.defaultPrevented
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
    expect(await copyText('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(setData).toHaveBeenCalledWith('text/plain', '11111111-1111-4111-8111-111111111111')
    expect(prevented).toBe(true)
    // The listener is gone afterwards.
    const later = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(later, 'clipboardData', { value: { setData } })
    document.body.dispatchEvent(later)
    expect(setData).toHaveBeenCalledTimes(1)
  })
})
