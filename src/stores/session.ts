import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getConsoleInfo } from '../api/client'
import type { ConsoleInfo } from '../api/types'

export const useSession = defineStore('session', () => {
  const info = ref<ConsoleInfo | null>(null)
  const centralEnabled = computed(() => info.value?.webhook_auth === false)
  const username = computed(() => info.value?.username ?? '')

  /** Propagates errors so the router guard can react to a 401 ApiError. */
  async function load(): Promise<void> {
    info.value = await getConsoleInfo()
  }
  function reset(): void {
    info.value = null
  }
  return { info, centralEnabled, username, load, reset }
})
