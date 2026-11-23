import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

/** FIFO queue; ConfirmHost renders the head one at a time. */
export const confirmQueue = reactive<ConfirmRequest[]>([])

export function useConfirm() {
  return {
    confirm(o: ConfirmOptions): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        confirmQueue.push({ ...o, resolve })
      })
    },
  }
}
