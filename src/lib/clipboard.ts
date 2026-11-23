/**
 * Copy text to the clipboard. `navigator.clipboard` only exists in secure contexts, and self-hosted
 * consoles are often opened over plain HTTP on a LAN IP, so fall back to a hidden textarea +
 * `document.execCommand('copy')`. Resolves to whether either path succeeded; never rejects.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied or unavailable: try the legacy path */
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  // A focus trap (open menu or dialog) can refuse to let the textarea take focus, leaving the copy
  // command with the wrong selection; so also put the text on the copy event itself.
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }
  document.body.appendChild(ta)
  document.addEventListener('copy', onCopy, true)
  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.removeEventListener('copy', onCopy, true)
    ta.remove()
    previous?.focus({ preventScroll: true })
  }
  return ok
}
