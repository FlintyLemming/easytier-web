import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadText } from '../../src/lib/download'

// Object URLs are spied on, and jsdom cannot navigate, so the anchor's click is replaced.
function stubDownload() {
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blobs.push(b as Blob)
    return 'blob:fake-url'
  })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const clicks: { inDom: boolean; href: string; hidden: boolean }[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({
      inDom: document.querySelector('a[download="x.toml"]') === this,
      href: this.getAttribute('href') ?? '',
      hidden: this.style.display === 'none',
    })
  })
  return { blobs, revoke, clicks }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('downloadText', () => {
  it('clicks a hidden a[download] pointing at a blob of the text, then revokes the object URL', async () => {
    vi.useFakeTimers()
    const { blobs, revoke, clicks } = stubDownload()

    downloadText('x.toml', 'mtu = 1300\n', 'application/toml')

    expect(clicks).toEqual([{ inDom: true, href: 'blob:fake-url', hidden: true }])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(blobs).toHaveLength(1)
    expect(blobs[0]!.type).toBe('application/toml')
    expect(await blobs[0]!.text()).toBe('mtu = 1300\n')
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:fake-url')
  })

  it('defaults to text/plain', () => {
    const { blobs } = stubDownload()
    downloadText('x.toml', 'hi')
    expect(blobs[0]!.type).toBe('text/plain')
  })
})
