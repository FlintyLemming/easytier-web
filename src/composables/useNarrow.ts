import { onBeforeUnmount, ref } from 'vue'

/** True while the viewport is narrower than `px` (matchMedia-driven; false without matchMedia). */
export function useNarrow(px = 640) {
  const narrow = ref(false)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`)
    narrow.value = mq.matches
    const on = (e: MediaQueryListEvent) => { narrow.value = e.matches }
    mq.addEventListener('change', on)
    onBeforeUnmount(() => mq.removeEventListener('change', on))
  }
  return narrow
}
