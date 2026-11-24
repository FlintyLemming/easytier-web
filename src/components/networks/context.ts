import type { InjectionKey, Ref } from 'vue'
import type { CentralNetworkDetail, GatewayInfo } from '../../api/types'

/** What the network detail page shares with its tab panels. */
export interface NetworkDetailContext {
  /** `GET /networks/{id}`; null until loaded. */
  detail: Ref<CentralNetworkDetail | null>
  gateway: Ref<GatewayInfo | null>
  /** Re-read the detail (after a settings save or a new secret). */
  reload(): Promise<void>
}

export const networkDetailKey: InjectionKey<NetworkDetailContext> = Symbol('networkDetail')

export type NetworkTab = 'members' | 'acl' | 'credentials' | 'settings'
