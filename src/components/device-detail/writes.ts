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
