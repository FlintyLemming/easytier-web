import type { RouteLocationRaw, Router } from 'vue-router'
import { updateMember } from '../../api/client'
import type { MemberPatch } from '../../api/types'
import { useToast } from '../../composables/useToast'
import { t } from '../../i18n'
import { useInventory } from '../../stores/inventory'

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** A refresh already in flight may carry pre-mutation data, so wait for a second one. */
export async function refreshInventoryFresh(): Promise<void> {
  const inventory = useInventory()
  await inventory.refresh()
  await inventory.refresh()
}

/** PATCH only the given member fields, then toast and refresh the inventory. Resolves to success. */
export async function patchMember(networkId: string, deviceId: string, patch: MemberPatch, okMessage: string): Promise<boolean> {
  const toast = useToast()
  try {
    await updateMember(networkId, deviceId, patch)
  } catch (e) {
    toast.error(t('detail.settings.saveFailed', { message: errorMessage(e) }))
    return false
  }
  toast.success(okMessage)
  await refreshInventoryFresh()
  return true
}

/**
 * Navigate after an async action only if the user is still on the route the action started from;
 * if they moved on meanwhile (Back/Forward, another link), leave them where they are.
 */
export async function pushIfStill(router: Router, startPath: string, to: RouteLocationRaw): Promise<void> {
  if (router.currentRoute.value.fullPath !== startPath) return
  await router.push(to)
}
