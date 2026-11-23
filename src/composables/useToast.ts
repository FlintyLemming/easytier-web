import { reactive } from 'vue'

export interface ToastItem {
  id: number
  kind: 'success' | 'error'
  message: string
}

export const toasts = reactive<ToastItem[]>([])
let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function dismissToast(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

function push(kind: ToastItem['kind'], message: string) {
  const id = ++seq
  toasts.push({ id, kind, message })
  timers.set(id, setTimeout(() => dismissToast(id), kind === 'error' ? 5000 : 3000))
}

export function useToast() {
  return {
    success: (msg: string) => push('success', msg),
    error: (msg: string) => push('error', msg),
  }
}
