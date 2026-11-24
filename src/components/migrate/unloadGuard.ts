/**
 * Asks before the tab is closed or reloaded while a migration step is in flight. Held by the
 * operation itself (not by a page), so it stays on after the user navigates away inside the app
 * and the current device is still being finished or rolled back.
 */
let holders = 0

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
}

/** Returns the release function; call it exactly once when the operation ends. */
export function holdUnload(): () => void {
  if (holders++ === 0) window.addEventListener('beforeunload', onBeforeUnload)
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holders === 0) window.removeEventListener('beforeunload', onBeforeUnload)
  }
}
