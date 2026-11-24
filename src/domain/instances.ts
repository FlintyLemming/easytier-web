import { CONFIG_NO_DELETE, CONFIG_READ_ONLY } from '../api/types'
import type { InstanceList, InstanceMeta, InstanceRunningInfo } from '../api/types'
import { ipv4FromU32 } from './format'

export type InstanceState = 'running' | 'starting' | 'error' | 'disabled'

export interface InstanceRow {
  id: string
  name: string
  state: InstanceState
  errorMsg: string | null
  ipv4: string | null
  /** Created on the device itself (`source: 'user'`), as opposed to pushed by the console. */
  local: boolean
  editable: boolean
  deletable: boolean
}

/**
 * The instances the manual page lists: everything but central-network instances, running ones
 * first, then disabled ones, each group in the order the API gave. An id in both groups is disabled.
 */
export function manualInstanceIds(
  list: InstanceList,
  centralIds: Iterable<string>,
): { id: string; disabled: boolean }[] {
  const central = new Set(centralIds)
  const disabled = list.disabled.filter((id) => !central.has(id))
  const disabledSet = new Set(disabled)
  const running = list.running.filter((id) => !central.has(id) && !disabledSet.has(id))
  return [
    ...running.map((id) => ({ id, disabled: false })),
    ...disabled.map((id) => ({ id, disabled: true })),
  ]
}

function stateOf(disabled: boolean, info: InstanceRunningInfo | null | undefined): InstanceState {
  if (disabled) return 'disabled'
  if (info?.running) return 'running'
  if (info?.error_msg) return 'error'
  return 'starting'
}

function ipv4Of(info: InstanceRunningInfo | null | undefined): string | null {
  const v4 = info?.my_node_info?.virtual_ipv4
  const addr = v4?.address?.addr
  if (typeof addr !== 'number') return null
  return `${ipv4FromU32(addr)}/${v4?.network_length ?? 0}`
}

export function buildInstanceRows(
  ids: { id: string; disabled: boolean }[],
  metas: Record<string, InstanceMeta>,
  infos: Record<string, InstanceRunningInfo | null>,
): InstanceRow[] {
  return ids
    .map(({ id, disabled }) => {
      const meta = metas[id]
      const info = infos[id]
      const state = stateOf(disabled, info)
      const permission = meta?.permission ?? 0
      return {
        id,
        name: meta?.networkName || meta?.instanceName || id,
        state,
        errorMsg: state === 'error' ? (info?.error_msg ?? null) : null,
        ipv4: ipv4Of(info),
        local: meta?.source === 'user',
        editable: (permission & CONFIG_READ_ONLY) === 0,
        deletable: (permission & CONFIG_NO_DELETE) === 0,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}
