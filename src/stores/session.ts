import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getConsoleInfo } from '../api/client'
import type { ConsoleInfo } from '../api/types'

export const useSession = defineStore('session', () => {
  const info = ref<ConsoleInfo | null>(null)
  const centralEnabled = computed(() => info.value?.webhook_auth === false)
  /**
   * Known to run in webhook mode (spec §6.9): upstream v2.7.1 then registers no `/networks*` routes.
   * Unknown (info not loaded) counts as central so a failed console-info load degrades to the old path.
   */
  const webhookMode = computed(() => info.value?.webhook_auth === true)
  const username = computed(() => info.value?.username ?? '')

  /** Propagates errors so the router guard can react to a 401 ApiError. */
  async function load(): Promise<void> {
    info.value = await getConsoleInfo()
  }
  function reset(): void {
    info.value = null
  }
  return { info, centralEnabled, webhookMode, username, load, reset }
})
