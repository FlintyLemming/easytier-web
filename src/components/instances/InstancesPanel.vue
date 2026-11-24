<script setup lang="ts">
import { v4 as uuidv4 } from 'uuid'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  deleteInstance,
  generateToml,
  getInstanceConfig,
  instanceInfo,
  instanceMetas,
  listInstances,
  parseToml,
  runInstance,
  saveInstanceConfig,
  setInstanceDisabled,
} from '../../api/client'
import type { InstanceMeta, InstanceRunningInfo } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useNarrow } from '../../composables/useNarrow'
import { usePolling } from '../../composables/usePolling'
import { useToast } from '../../composables/useToast'
import type { DeviceView } from '../../domain/devices'
import { buildInstanceRows, manualInstanceIds, type InstanceRow } from '../../domain/instances'
import { splitLegacyVpn } from '../../domain/vpnPortal'
import { downloadText } from '../../lib/download'
import { DEFAULT_NETWORK_CONFIG, normalizeNetworkConfig, toBackendNetworkConfig, type NetworkConfig } from '../../lib/networkConfig'
import ConfigEditorDialog from '../config-editor/ConfigEditorDialog.vue'
import { errorMessage } from '../device-detail/writes'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import InstanceRowView from './InstanceRowView.vue'

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

const POLL_MS = 5_000

// --- reading ---

/** null until the first successful read. */
const rows = ref<InstanceRow[] | null>(null)
/** The running info of each listed running instance, as last read; the VPN Portal dialog reads it. */
const infos = shallowRef<Record<string, InstanceRunningInfo | null>>({})
const loadError = ref<string | null>(null)
const retrying = ref(false)
/** Metas only change through an edit or a delete here, which drop the entry. */
const metas: Record<string, InstanceMeta> = {}
/** Bumped per read; a read finishing after a newer one started (or the device went offline) is dropped. */
let seq = 0

async function refresh(): Promise<void> {
  const machineId = props.device.id
  const mine = ++seq
  try {
    const ids = manualInstanceIds(await listInstances(machineId), props.centralIds)
    const unknown = ids.map((i) => i.id).filter((id) => !metas[id])
    if (unknown.length) Object.assign(metas, await instanceMetas(machineId, unknown))
    const next: Record<string, InstanceRunningInfo | null> = {}
    await Promise.all(
      ids.filter((i) => !i.disabled).map(async ({ id }) => {
        next[id] = await instanceInfo(machineId, id)
      }),
    )
    if (mine !== seq) return
    infos.value = next
    rows.value = buildInstanceRows(ids, metas, next)
    loadError.value = null
  } catch (e) {
    if (mine !== seq) return
    loadError.value = errorMessage(e)
  }
}

async function retry() {
  retrying.value = true
  try {
    await refresh()
  } finally {
    retrying.value = false
  }
}

const online = computed(() => props.device.online)
const poller = usePolling(refresh, POLL_MS)
// An offline device is not asked anything; it is read again as soon as it is back.
watch(
  online,
  (on) => {
    if (on) {
      poller.start()
    } else {
      poller.stop()
      seq++
    }
  },
  { immediate: true },
)

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
    await setInstanceDisabled(machineId, row.id, !disabled)
    toast.success(disabled ? t('instances.enabled') : t('instances.disabled'))
    await refresh()
  })
}

function exportToml(row: InstanceRow) {
  return rowTask(
    row,
    async (machineId) => {
      const config = toBackendNetworkConfig(normalizeNetworkConfig((await getInstanceConfig(machineId, row.id)) as NetworkConfig))
      // web 2.7 rejects the legacy VPN portal fields, so they stay out of the file, which says so.
      const { rest, legacy } = splitLegacyVpn(config)
      const { instance_id: _id, ...portable } = rest
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
  const ok = await confirm({
    title: t('instances.deleteTitle'),
    body: t('instances.deleteBody', { name: row.name }),
    confirmLabel: t('devices.deleteConfirm'),
    danger: true,
  })
  if (!ok) return
  await rowTask(row, async (machineId) => {
    await deleteInstance(machineId, row.id)
    delete metas[row.id]
    toast.success(t('instances.deleted', { name: row.name }))
    await refresh()
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

function openEditor(target: EditorTarget, initial: NetworkConfig) {
  editorMachine = props.device.id
  editorTarget.value = target
  editorInitial.value = initial
  editorOpen.value = true
}

function create(initial: NetworkConfig = DEFAULT_NETWORK_CONFIG()) {
  openEditor({ kind: 'create' }, initial)
}

function edit(row: InstanceRow) {
  return rowTask(row, async (machineId) => {
    const config = normalizeNetworkConfig((await getInstanceConfig(machineId, row.id)) as NetworkConfig)
    // Running covers starting and failed ones too: the instance is in the running list.
    openEditor({ kind: 'edit', id: row.id, name: row.name, running: row.state !== 'disabled' }, config)
  })
}

async function save(key: string, draft: NetworkConfig) {
  if (saving.value) return
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
    if (target.kind === 'edit') delete metas[target.id]
    toast.success(target.kind === 'edit' ? t('instances.saved', { name }) : t('instances.created', { name }))
    editorOpen.value = false
    void refresh()
  } catch (e) {
    // The dialog stays open with the draft, so the user can retry or adjust.
    toast.error(t('instances.failed', { message: errorMessage(e) }))
  } finally {
    saving.value = false
  }
}

// --- 导入 TOML ---

const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

async function importFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || importing.value) {
    input.value = ''
    return
  }
  importing.value = true
  try {
    const r = await parseToml(await file.text())
    if ('error' in r) {
      toast.error(t('instances.parseFailed', { message: r.error }))
      return
    }
    // An import is a new instance, even when the file carries the id of an existing one.
    const config = normalizeNetworkConfig(r.config as unknown as NetworkConfig)
    config.instance_id = uuidv4()
    create(config)
  } catch (err) {
    toast.error(t('instances.parseFailed', { message: errorMessage(err) }))
  } finally {
    // Cleared so picking the same file again fires `change` again.
    input.value = ''
    importing.value = false
  }
}
</script>

<template>
  <section data-testid="instances-panel" class="rounded-card border border-hairline bg-surface-card">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft px-5 py-3">
      <h2 class="caption-uppercase text-muted">{{ t('instances.title') }}</h2>
      <div v-if="online" class="flex flex-wrap items-center gap-2">
        <!-- The page's single main action, so it carries the orange primary style. -->
        <UiButton variant="primary" size="sm" @click="create()">{{ t('instances.new') }}</UiButton>
        <UiButton size="sm" :loading="importing" @click="fileInput?.click()">{{ t('instances.import') }}</UiButton>
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
          @edit="edit(row)"
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
            @edit="edit(row)"
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
      :note="editorNote"
      :actions="editorActions"
      @action="save"
    />
  </section>
</template>
