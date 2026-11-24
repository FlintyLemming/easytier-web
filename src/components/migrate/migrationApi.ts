import {
  addMembers, deleteInstance, generateToml, getInstanceConfig, listInstances, listMembers, nodeInfo, parseToml,
  removeMember, runInstance, saveInstanceConfig, setInstanceDisabled, setMemberConfig, updateMember,
} from '../../api/client'
import type { MigrationApi } from '../../domain/migration/run'

/** The real client functions the migration runner uses. */
export const migrationApi: MigrationApi = {
  setInstanceDisabled,
  getInstanceConfig,
  listInstances,
  deleteInstance,
  runInstance,
  saveInstanceConfig,
  addMembers: (networkId, deviceIds) => addMembers(networkId, deviceIds),
  updateMember,
  setMemberConfig,
  removeMember,
  listMembers,
  nodeInfo,
  generateToml,
  parseToml,
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYYMMDD-HHMMSS` in local time, for download file names. */
export function fileStamp(now: Date): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}
