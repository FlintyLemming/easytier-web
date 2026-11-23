import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

/** FIFO queue; ConfirmHost renders the head one at a time. */
export const confirmQueue = reactive<ConfirmRequest[]>([])

let seq = 0

/** Settle request `id`; no-op unless it is still the queue head (each request resolves once). */
export function settleConfirm(id: number, ok: boolean) {
  if (confirmQueue[0]?.id !== id) return
  const req = confirmQueue.shift()!
  req.resolve(ok)
}

export function useConfirm() {
  return {
    confirm(o: ConfirmOptions): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        confirmQueue.push({ ...o, id: ++seq, resolve })
      })
    },
  }
}
