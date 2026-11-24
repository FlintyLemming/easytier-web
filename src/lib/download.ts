/**
 * Some engines still read the blob after `click()` returns, so the object URL is revoked a moment
 * later rather than at once.
 */
const REVOKE_DELAY_MS = 1_000

/** Save `text` as a file named `filename` through a hidden `<a download>`. */
export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}
