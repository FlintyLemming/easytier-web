<script setup lang="ts">
import { v4 as uuidv4 } from 'uuid'
import { computed, reactive, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  deleteInstance,
  generateToml,
  getInstanceConfig,
  parseToml,
  runInstance,
  saveInstanceConfig,
  setInstanceDisabled,
} from '../../api/client'
import { useConfirm } from '../../composables/useConfirm'
import { useInstanceRows } from '../../composables/useInstanceRows'
import { useNarrow } from '../../composables/useNarrow'
import { useToast } from '../../composables/useToast'
import type { DeviceView } from '../../domain/devices'
import type { InstanceRow } from '../../domain/instances'
import { splitLegacyVpn } from '../../domain/vpnPortal'
import { downloadText } from '../../lib/download'
import { DEFAULT_NETWORK_CONFIG, normalizeNetworkConfig, toBackendNetworkConfig, type NetworkConfig } from '../../lib/networkConfig'
import ConfigEditorDialog from '../config-editor/ConfigEditorDialog.vue'
import { errorMessage } from '../device-detail/writes'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import InstanceRowView from './InstanceRowView.vue'
import VpnPortalDialog from './VpnPortalDialog.vue'

// The device's manual instances (spec §6.7): everything it runs except central-network instances.
const props = defineProps<{
  device: DeviceView
  /** Ids of the central networks; their instances are not manual ones. Empty in webhook mode. */
  centralIds: string[]
}>()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const narrow = useNarrow(640)

// --- reading (polled every 5 s, single-flight; see useInstanceRows) ---

// `infos` (each running instance's last read info) also feeds the VPN Portal dialog.
const { rows, infos, loadError, retrying, online, refreshNow, retry, dropMeta, rereadMeta } = useInstanceRows(
  () => props.device,
  () => props.centralIds,
)

/**
 * Nothing is sent to an offline device, user actions included: checked right before every request
 * (after any await, such as the confirm), an action that finds the device offline stops and says so.
 */
function stillOnline(): boolean {
  if (props.device.online) return true
  toast.error(t('instances.offline'))
  return false
}

// --- row actions ---

/** Instances with an action under way; their menus are disabled until the list is read again. */
const pending = reactive(new Set<string>())

async function rowTask(row: InstanceRow, task: (machineId: string) => Promise<void>, failure = 'instances.failed') {
  if (pending.has(row.id)) return
  pending.add(row.id)
  try {
    await task(props.device.id)
  } catch (e) {
    toast.error(t(failure, { message: errorMessage(e) }))
  } finally {
    pending.delete(row.id)
  }
}

function toggle(row: InstanceRow) {
  const disabled = row.state === 'disabled'
  return rowTask(row, async (machineId) => {
    if (!stillOnline()) return
    await setInstanceDisabled(machineId, row.id, !disabled)
    toast.success(disabled ? t('instances.enabled') : t('instances.disabled'))
    await refreshNow()
  })
}

function exportToml(row: InstanceRow) {
  return rowTask(
    row,
    async (machineId) => {
      if (!stillOnline()) return
      const config = toBackendNetworkConfig(normalizeNetworkConfig((await getInstanceConfig(machineId, row.id)) as NetworkConfig))
      // web 2.7 rejects the legacy VPN portal fields, so they stay out of the file, which says so.
      const { rest, legacy } = splitLegacyVpn(config)
      const { instance_id: _id, ...portable } = rest
      if (!stillOnline()) return
      const r = await generateToml(portable)
      if ('error' in r) {
        toast.error(t('instances.exportFailed', { message: r.error }))
        return
      }
      const note = Object.keys(legacy).length > 0 ? `${t('instances.exportLegacyNote')}\n` : ''
      downloadText(`${row.name}.toml`, note + r.toml, 'application/toml')
    },
    'instances.exportFailed',
  )
}

async function remove(row: InstanceRow) {
  if (!stillOnline()) return
  const ok = await confirm({
    title: t('instances.deleteTitle'),
    body: t('instances.deleteBody', { name: row.name }),
    confirmLabel: t('devices.deleteConfirm'),
    danger: true,
  })
  if (!ok) return
  await rowTask(row, async (machineId) => {
    // The device may have gone offline while the confirm was open.
    if (!stillOnline()) return
    await deleteInstance(machineId, row.id)
    dropMeta(row.id)
    toast.success(t('instances.deleted', { name: row.name }))
    await refreshNow()
  })
}

// --- the editor: 新建实例, 导入 TOML and 编辑 share one dialog ---

type EditorTarget = { kind: 'create' } | { kind: 'edit'; id: string; name: string; running: boolean }

const editorOpen = ref(false)
const editorTarget = shallowRef<EditorTarget>({ kind: 'create' })
const editorInitial = shallowRef<NetworkConfig>(DEFAULT_NETWORK_CONFIG())
const saving = ref(false)
/** The device the open editor writes to, captured when it opens. */
let editorMachine = ''

const editorTitle = computed(() => {
  const target = editorTarget.value
  return target.kind === 'edit' ? t('instances.editTitle', { name: target.name }) : t('instances.createTitle')
})
const editorNote = computed(() => {
  // An offline device takes no writes: the draft stays, its actions wait until the device is back.
  if (!online.value) return t('instances.offline')
  const target = editorTarget.value
  return target.kind === 'edit' && target.running ? t('instances.restartNote') : undefined
})
const editorActions = computed(() =>
  editorTarget.value.kind === 'edit'
    ? [{ key: 'save', label: t('instances.save') }]
    : [
        { key: 'run', label: t('instances.createRun') },
        { key: 'save', label: t('instances.createSave') },
      ],
)

// The dialog takes its draft from `initial` only as it opens, while its title, actions and note follow
// `editorTarget` live. So an editor opening may never overtake another: an edit (reading the config)
// or an import (parsing the file) is one opening at a time, 编辑, 新建实例 and 导入 TOML wait for it,
// and a result that finds the editor open or a newer opening started is dropped. The target and the
// draft then always come from the same opening (else a save could write one instance's config under
// another one's id).

/** The edit or import reading what the editor will open with, if any. */
const opening = ref<'edit' | 'import' | null>(null)
/** Bumped per opening: only the latest one may open the editor. */
let openings = 0

/** Starts an opening; null while another is under way or the editor is open. */
function beginOpening(kind: 'edit' | 'import'): number | null {
  if (opening.value !== null || editorOpen.value) return null
  opening.value = kind
  return ++openings
}

function endOpening(token: number) {
  if (token === openings) opening.value = null
}

function openEditor(token: number, target: EditorTarget, initial: NetworkConfig) {
  if (token !== openings || editorOpen.value) return
  editorMachine = props.device.id
  editorTarget.value = target
  editorInitial.value = initial
  editorOpen.value = true
}

function create() {
  if (opening.value !== null || editorOpen.value) return
  openEditor(++openings, { kind: 'create' }, DEFAULT_NETWORK_CONFIG())
}

function edit(row: InstanceRow) {
  return rowTask(row, async (machineId) => {
    if (!stillOnline()) return
    const token = beginOpening('edit')
    if (token === null) return
    try {
      const config = normalizeNetworkConfig((await getInstanceConfig(machineId, row.id)) as NetworkConfig)
      // Offline by the time the config arrived: no editor whose save could not be sent.
      if (!stillOnline()) return
      // Running covers starting and failed ones too: the instance is in the running list.
      openEditor(token, { kind: 'edit', id: row.id, name: row.name, running: row.state !== 'disabled' }, config)
    } finally {
      endOpening(token)
    }
  })
}

async function save(key: string, draft: NetworkConfig) {
  // The dialog disables its actions while the device is offline; this is the last line.
  if (saving.value || !stillOnline()) return
  const target = editorTarget.value
  const machineId = editorMachine
  // An existing instance keeps its id whatever the TOML said.
  const config: NetworkConfig = target.kind === 'edit' ? { ...draft, instance_id: target.id } : draft
  const backend = toBackendNetworkConfig(config)
  const run = target.kind === 'edit' ? target.running : key === 'run'
  const name = config.network_name || (target.kind === 'edit' ? target.name : config.instance_id)
  saving.value = true
  try {
    if (run) await runInstance(machineId, backend, true)
    else await saveInstanceConfig(machineId, config.instance_id, backend)
    if (target.kind === 'edit') rereadMeta(target.id)
    toast.success(target.kind === 'edit' ? t('instances.saved', { name }) : t('instances.created', { name }))
    editorOpen.value = false
    void refreshNow()
  } catch (e) {
    // The dialog stays open with the draft, so the user can retry or adjust.
    toast.error(t('instances.failed', { message: errorMessage(e) }))
  } finally {
    saving.value = false
  }
}

// --- VPN Portal ---

/** The instance whose VPN Portal dialog is open and the device it was opened on; null when closed. */
const vpn = shallowRef<{ machineId: string; row: InstanceRow; opening: number } | null>(null)
let vpnOpenings = 0

function openVpn(row: InstanceRow) {
  if (!stillOnline()) return
  vpn.value = { machineId: props.device.id, row, opening: ++vpnOpenings }
}

// --- 导入 TOML ---

const fileInput = ref<HTMLInputElement | null>(null)
const importing = computed(() => opening.value === 'import')

async function importFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  const token = file ? beginOpening('import') : null
  if (!file || token === null) {
    input.value = ''
    return
  }
  try {
    const text = await file.text()
    if (!stillOnline()) return
    const r = await parseToml(text)
    if ('error' in r) {
      toast.error(t('instances.parseFailed', { message: r.error }))
      return
    }
    // An import is a new instance, even when the file carries the id of an existing one.
    const config = normalizeNetworkConfig(r.config as unknown as NetworkConfig)
    config.instance_id = uuidv4()
    if (!stillOnline()) return
    openEditor(token, { kind: 'create' }, config)
  } catch (err) {
    toast.error(t('instances.parseFailed', { message: errorMessage(err) }))
  } finally {
    // Cleared so picking the same file again fires `change` again.
    input.value = ''
    endOpening(token)
  }
}
</script>

<template>
  <section data-testid="instances-panel" class="rounded-card border border-hairline bg-surface-card">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft px-5 py-3">
      <h2 class="caption-uppercase text-muted">{{ t('instances.title') }}</h2>
      <div v-if="online" class="flex flex-wrap items-center gap-2">
        <!-- The page's single main action, so it carries the orange primary style. -->
        <UiButton variant="primary" size="sm" :disabled="opening !== null" @click="create()">{{ t('instances.new') }}</UiButton>
        <UiButton size="sm" :loading="importing" :disabled="opening !== null" @click="fileInput?.click()">{{ t('instances.import') }}</UiButton>
        <input ref="fileInput" type="file" accept=".toml,text/plain" class="hidden" @change="importFile" />
      </div>
    </header>

    <EmptyState v-if="!online" :title="t('instances.offline')" />

    <div v-else-if="rows === null" :class="loadError ? '' : 'p-5'">
      <EmptyState v-if="loadError" :title="t('instances.loadFailed')" :body="loadError">
        <template #action>
          <UiButton :loading="retrying" @click="retry">{{ t('detail.retry') }}</UiButton>
        </template>
      </EmptyState>
      <SkeletonRows v-else :rows="3" />
    </div>

    <template v-else>
      <p
        v-if="loadError"
        role="status"
        :title="loadError"
        class="border-b border-hairline bg-canvas-soft px-5 py-2 text-[13px] text-body"
      >
        {{ t('instances.refreshFailed') }}
      </p>
      <EmptyState v-if="rows.length === 0" :title="t('instances.empty')" />
      <ul v-else-if="narrow" class="flex flex-col">
        <InstanceRowView
          v-for="row in rows"
          :key="row.id"
          :row="row"
          card
          :busy="pending.has(row.id)"
          :edit-locked="opening !== null"
          @edit="edit(row)"
          @vpn="openVpn(row)"
          @toggle="toggle(row)"
          @export="exportToml(row)"
          @delete="remove(row)"
        />
      </ul>
      <table v-else :aria-label="t('instances.title')" class="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col style="width: 30%" />
          <col style="width: 22%" />
          <col style="width: 52px" />
        </colgroup>
        <tbody>
          <InstanceRowView
            v-for="row in rows"
            :key="row.id"
            :row="row"
            :card="false"
            :busy="pending.has(row.id)"
            :edit-locked="opening !== null"
            @edit="edit(row)"
            @vpn="openVpn(row)"
            @toggle="toggle(row)"
            @export="exportToml(row)"
            @delete="remove(row)"
          />
        </tbody>
      </table>
    </template>

    <ConfigEditorDialog
      v-model:open="editorOpen"
      :title="editorTitle"
      mode="instance"
      :initial="editorInitial"
      :core-version="device.version"
      :busy="saving"
      :disabled="!online"
      :note="editorNote"
      :actions="editorActions"
      @action="save"
    />

    <!-- Mounted per opening, so an answer meant for one opening never shows in another. -->
    <VpnPortalDialog
      v-if="vpn"
      :key="vpn.opening"
      :machine-id="vpn.machineId"
      :row="vpn.row"
      :info="infos[vpn.row.id] ?? null"
      :core-version="device.version"
      :online="online"
      @close="vpn = null"
    />
  </section>
</template>
