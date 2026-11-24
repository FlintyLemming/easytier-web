import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
import {
  deleteInstance,
  getInstanceConfig,
  instanceInfo,
  instanceMetas,
  listInstances,
  runInstance,
  saveInstanceConfig,
  setInstanceDisabled,
} from '../../src/api/client'
import type { InstanceList, InstanceMeta, InstanceRunningInfo } from '../../src/api/types'
import InstancesPanel from '../../src/components/instances/InstancesPanel.vue'
import { confirmQueue, settleConfirm } from '../../src/composables/useConfirm'
import { toasts } from '../../src/composables/useToast'
import type { DeviceView } from '../../src/domain/devices'
import type { InstanceRow } from '../../src/domain/instances'
import { i18n } from '../../src/i18n'
import type { NetworkConfig } from '../../src/lib/networkConfig'

vi.mock('../../src/api/client', () => ({
  deleteInstance: vi.fn(),
  generateToml: vi.fn(),
  getInstanceConfig: vi.fn(),
  instanceInfo: vi.fn(),
  instanceMetas: vi.fn(),
  listInstances: vi.fn(),
  parseToml: vi.fn(),
  runInstance: vi.fn(),
  saveInstanceConfig: vi.fn(),
  setInstanceDisabled: vi.fn(),
}))

const list = vi.mocked(listInstances)
const metasApi = vi.mocked(instanceMetas)
const info = vi.mocked(instanceInfo)
const toggleApi = vi.mocked(setInstanceDisabled)
const deleteApi = vi.mocked(deleteInstance)
const saveApi = vi.mocked(saveInstanceConfig)
const runApi = vi.mocked(runInstance)
const configApi = vi.mocked(getInstanceConfig)

const A = '5eed0000-0000-4000-8000-00000000000a'
const B = '5eed0000-0000-4000-8000-00000000000b'

const RUNNING: InstanceRunningInfo = {
  running: true,
  my_node_info: { virtual_ipv4: { address: { addr: 0x0a580003 }, network_length: 24 } },
}

function meta(name: string, permission = 0): InstanceMeta {
  return { networkName: name, instanceName: name, source: 'web', permission } as InstanceMeta
}

function device(online = true): DeviceView {
  return {
    id: 'm1', name: 'core2', hostname: 'core2', alias: null, os: 'linux',
    online, lastSeen: null, version: '2.6.4', outdated: false,
    publicIp: null, location: null, knownLocation: null, locationCached: false,
    networks: [], defaultNetworkId: null, member: null, ip: null, pending: false,
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// A row that shows what it was given and emits the menu actions on click.
const RowStub = defineComponent({
  name: 'InstanceRowView',
  props: {
    row: { type: Object as PropType<InstanceRow>, required: true },
    card: Boolean,
    busy: Boolean,
  },
  emits: ['edit', 'toggle', 'export', 'delete'],
  setup(props, { emit }) {
    return () =>
      h('tr', { 'data-row': props.row.id, 'data-state': props.row.state, 'data-name': props.row.name }, [
        h('td', [
          // The menu items the real row would offer.
          props.row.editable ? h('button', { 'data-act': 'edit', onClick: () => emit('edit') }) : null,
          h('button', { 'data-act': 'toggle', onClick: () => emit('toggle') }),
          props.row.deletable ? h('button', { 'data-act': 'delete', onClick: () => emit('delete') }) : null,
        ]),
      ])
  },
})

// The editor dialog reduced to its action buttons, each emitting the initial config as the draft.
const DialogStub = defineComponent({
  name: 'ConfigEditorDialog',
  props: {
    open: Boolean,
    initial: { type: Object as PropType<NetworkConfig>, required: true },
    actions: { type: Array as PropType<{ key: string; label: string }[]>, required: true },
    disabled: Boolean,
    note: String,
  },
  emits: ['action', 'update:open'],
  setup(props, { emit }) {
    // The buttons emit even when `disabled`, so the tests reach the panel's own guard too.
    return () =>
      props.open
        ? h(
            'div',
            { 'data-dialog': '', 'data-disabled': String(props.disabled), 'data-note': props.note ?? '' },
            props.actions.map((a) => h('button', { 'data-action': a.key, onClick: () => emit('action', a.key, props.initial) })),
          )
        : null
  },
})

const wrappers: VueWrapper[] = []

function mountPanel(online = true) {
  const w = mount(InstancesPanel, {
    props: { device: device(online), centralIds: [] },
    global: { plugins: [i18n], stubs: { InstanceRowView: RowStub, ConfigEditorDialog: DialogStub } },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

function rowsOf(w: VueWrapper) {
  return w.findAll('[data-row]').map((r) => ({ id: r.attributes('data-row'), name: r.attributes('data-name'), state: r.attributes('data-state') }))
}

const listed = (running: string[], disabled: string[] = []): InstanceList => ({ running, disabled })

beforeEach(() => {
  vi.resetAllMocks()
  list.mockResolvedValue(listed([A, B]))
  metasApi.mockImplementation(async (_m, ids) => Object.fromEntries(ids.map((id) => [id, meta(id === A ? 'alpha' : 'beta')])))
  info.mockResolvedValue(RUNNING)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
  confirmQueue.splice(0)
  toasts.splice(0)
  vi.useRealTimers()
})

describe('InstancesPanel reads', () => {
  it('lists every instance when one instance info fails', async () => {
    info.mockImplementation(async (_m, id) => {
      if (id === B) throw new Error('rpc timeout for one instance')
      return RUNNING
    })
    const w = mountPanel()
    await flushPromises()
    expect(rowsOf(w)).toEqual([
      { id: A, name: 'alpha', state: 'running' },
      { id: B, name: 'beta', state: 'starting' },
    ])
    expect(w.text()).not.toContain(i18n.global.t('instances.loadFailed'))
    expect(w.text()).not.toContain(i18n.global.t('instances.refreshFailed'))
  })

  it("keeps an instance's last info when a later info read fails, and still applies the rest of the read", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const w = mountPanel()
    await flushPromises()
    expect(rowsOf(w).map((r) => r.state)).toEqual(['running', 'running'])

    // Next read: B's info fails, and A is now disabled.
    list.mockResolvedValue(listed([B], [A]))
    info.mockRejectedValue(new Error('rpc timeout'))
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(rowsOf(w)).toEqual([
      { id: A, name: 'alpha', state: 'disabled' },
      { id: B, name: 'beta', state: 'running' },
    ])
    expect(w.text()).not.toContain(i18n.global.t('instances.refreshFailed'))
  })

  it('lists the instances under their ids when the metas read fails, and asks for them again on the next read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    metasApi.mockRejectedValueOnce(new Error('metas down'))
    const w = mountPanel()
    await flushPromises()
    expect(rowsOf(w).map((r) => r.name).sort()).toEqual([A, B].sort())
    expect(rowsOf(w).map((r) => r.state)).toEqual(['running', 'running'])
    expect(w.text()).not.toContain(i18n.global.t('instances.loadFailed'))

    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(metasApi).toHaveBeenCalledTimes(2)
    expect(metasApi.mock.calls[1]![1]).toEqual([A, B])
    expect(rowsOf(w).map((r) => r.name)).toEqual(['alpha', 'beta'])
  })

  it('fails the read when the list itself fails', async () => {
    list.mockRejectedValue(new Error('list down'))
    const w = mountPanel()
    await flushPromises()
    expect(rowsOf(w)).toEqual([])
    expect(w.text()).toContain(i18n.global.t('instances.loadFailed'))
    expect(w.text()).toContain('list down')
  })
})

describe('InstancesPanel sends nothing to an offline device or after unmount', () => {
  it('stops after the list when the device goes offline mid-read', async () => {
    const pending = deferred<InstanceList>()
    list.mockReturnValueOnce(pending.promise)
    const w = mountPanel()
    expect(list).toHaveBeenCalledTimes(1)
    await w.setProps({ device: device(false) })
    pending.resolve(listed([A, B]))
    await flushPromises()
    expect(metasApi).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('sends no info request when the device goes offline while the metas are read', async () => {
    const pending = deferred<Record<string, InstanceMeta>>()
    metasApi.mockReturnValueOnce(pending.promise)
    const w = mountPanel()
    await flushPromises()
    expect(metasApi).toHaveBeenCalledTimes(1)
    await w.setProps({ device: device(false) })
    pending.resolve({ [A]: meta('alpha'), [B]: meta('beta') })
    await flushPromises()
    expect(info).not.toHaveBeenCalled()
  })

  it('stops after the list when the panel unmounts mid-read', async () => {
    const pending = deferred<InstanceList>()
    list.mockReturnValueOnce(pending.promise)
    const w = mountPanel()
    w.unmount()
    wrappers.splice(wrappers.indexOf(w), 1)
    pending.resolve(listed([A, B]))
    await flushPromises()
    expect(metasApi).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('does not read the list after a toggle that finishes once the device is offline', async () => {
    const w = mountPanel()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    const put = deferred<void>()
    toggleApi.mockReturnValueOnce(put.promise)
    await w.find(`[data-row="${A}"] [data-act="toggle"]`).trigger('click')
    expect(toggleApi).toHaveBeenCalledWith('m1', A, true)
    await w.setProps({ device: device(false) })
    put.resolve()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('does not read the list after a delete that finishes once the panel is gone', async () => {
    const w = mountPanel()
    await flushPromises()
    const del = deferred<void>()
    deleteApi.mockReturnValueOnce(del.promise)
    await w.find(`[data-row="${A}"] [data-act="delete"]`).trigger('click')
    settleConfirm(confirmQueue[0]!.id, true)
    await flushPromises()
    expect(deleteApi).toHaveBeenCalledWith('m1', A)
    w.unmount()
    wrappers.splice(wrappers.indexOf(w), 1)
    del.resolve()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('does not read the list after a save that finishes once the device is offline', async () => {
    const w = mountPanel()
    await flushPromises()
    const put = deferred<void>()
    saveApi.mockReturnValueOnce(put.promise)
    await w.find('button.bg-primary').trigger('click')
    await w.find('[data-action="save"]').trigger('click')
    expect(saveApi).toHaveBeenCalledTimes(1)
    await w.setProps({ device: device(false) })
    put.resolve()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('reads again once the device is back online', async () => {
    const w = mountPanel(false)
    await flushPromises()
    expect(list).not.toHaveBeenCalled()
    await w.setProps({ device: device(true) })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    expect(rowsOf(w).map((r) => r.name)).toEqual(['alpha', 'beta'])
  })
})

const OFFLINE = () => i18n.global.t('instances.offline')
const toastTexts = () => toasts.map((x) => x.message)

describe('InstancesPanel actions send nothing once the device is offline (R14a)', () => {
  it('an editor open when the device goes offline keeps its draft, disables its actions, and 保存 sends nothing', async () => {
    const w = mountPanel()
    await flushPromises()
    await w.find('button.bg-primary').trigger('click')
    expect(w.find('[data-dialog]').attributes('data-disabled')).toBe('false')
    await w.setProps({ device: device(false) })
    const dlg = w.find('[data-dialog]')
    expect(dlg.exists()).toBe(true)
    expect(dlg.attributes('data-disabled')).toBe('true')
    expect(dlg.attributes('data-note')).toBe(OFFLINE())
    await dlg.find('[data-action="save"]').trigger('click')
    await dlg.find('[data-action="run"]').trigger('click')
    await flushPromises()
    expect(saveApi).not.toHaveBeenCalled()
    expect(runApi).not.toHaveBeenCalled()
    expect(w.find('[data-dialog]').exists()).toBe(true)
    expect(toastTexts()).toContain(OFFLINE())

    // Back online: the same dialog saves.
    await w.setProps({ device: device(true) })
    expect(w.find('[data-dialog]').attributes('data-disabled')).toBe('false')
    await w.find('[data-action="save"]').trigger('click')
    await flushPromises()
    expect(saveApi).toHaveBeenCalledTimes(1)
  })

  it('an edit dialog of a running instance sends no runInstance once the device is offline', async () => {
    configApi.mockResolvedValue({ instance_id: A, network_name: 'alpha', networking_method: 'Manual' })
    const w = mountPanel()
    await flushPromises()
    await w.find(`[data-row="${A}"] [data-act="edit"]`).trigger('click')
    await flushPromises()
    expect(w.find('[data-dialog]').attributes('data-note')).toBe(i18n.global.t('instances.restartNote'))
    await w.setProps({ device: device(false) })
    await w.find('[data-dialog] [data-action="save"]').trigger('click')
    await flushPromises()
    expect(runApi).not.toHaveBeenCalled()
    expect(saveApi).not.toHaveBeenCalled()
    expect(w.find('[data-dialog]').exists()).toBe(true)
  })

  it('a delete confirmed after the device went offline sends no DELETE', async () => {
    const w = mountPanel()
    await flushPromises()
    await w.find(`[data-row="${A}"] [data-act="delete"]`).trigger('click')
    expect(confirmQueue).toHaveLength(1)
    await w.setProps({ device: device(false) })
    settleConfirm(confirmQueue[0]!.id, true)
    await flushPromises()
    expect(deleteApi).not.toHaveBeenCalled()
    expect(toastTexts()).toContain(OFFLINE())
  })

  it('an edit whose config arrives after the device went offline opens no editor', async () => {
    const cfg = deferred<Record<string, unknown>>()
    configApi.mockReturnValueOnce(cfg.promise)
    const w = mountPanel()
    await flushPromises()
    await w.find(`[data-row="${A}"] [data-act="edit"]`).trigger('click')
    expect(configApi).toHaveBeenCalledTimes(1)
    await w.setProps({ device: device(false) })
    cfg.resolve({ instance_id: A, network_name: 'alpha', networking_method: 'Manual' })
    await flushPromises()
    expect(w.find('[data-dialog]').exists()).toBe(false)
    expect(toastTexts()).toContain(OFFLINE())
  })
})

describe('InstancesPanel reads are single-flight (R14b)', () => {
  it('a toggle during a slow list read waits for it, then reads the state after the PUT; never two lists at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const w = mountPanel()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)

    // From now on every list read is slow and answered by hand.
    let inFlight = 0
    let maxInFlight = 0
    const answers: { resolve: (l: InstanceList) => void }[] = []
    list.mockImplementation(() => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const d = deferred<InstanceList>()
      answers.push(d)
      return d.promise.finally(() => inFlight--)
    })

    await vi.advanceTimersByTimeAsync(5_000) // the poll's read starts and hangs
    expect(list).toHaveBeenCalledTimes(2)
    toggleApi.mockResolvedValue(undefined)
    await w.find(`[data-row="${A}"] [data-act="toggle"]`).trigger('click')
    await flushPromises()
    expect(toggleApi).toHaveBeenCalledWith('m1', A, true)
    expect(list).toHaveBeenCalledTimes(2) // queued behind the poll's read, not sent alongside it
    await vi.advanceTimersByTimeAsync(5_000) // a poll tick while the read hangs joins it
    expect(list).toHaveBeenCalledTimes(2)

    answers[0]!.resolve(listed([A, B])) // the poll's read: from before the PUT
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(3) // the toggle's read follows at once
    expect(list.mock.invocationCallOrder[2]!).toBeGreaterThan(toggleApi.mock.invocationCallOrder[0]!)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(list).toHaveBeenCalledTimes(3)

    answers[1]!.resolve(listed([B], [A]))
    await flushPromises()
    expect(rowsOf(w).find((r) => r.id === A)!.state).toBe('disabled')
    expect(maxInFlight).toBe(1)
  })

  it('several actions during one read queue a single follow-up read', async () => {
    const w = mountPanel()
    await flushPromises()
    const slow = deferred<InstanceList>()
    list.mockReturnValueOnce(slow.promise)
    toggleApi.mockResolvedValue(undefined)
    deleteApi.mockResolvedValue(undefined)
    await w.find(`[data-row="${A}"] [data-act="toggle"]`).trigger('click') // read #2 starts, hangs
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    await w.find(`[data-row="${B}"] [data-act="toggle"]`).trigger('click')
    await w.find(`[data-row="${B}"] [data-act="delete"]`).trigger('click')
    settleConfirm(confirmQueue[0]!.id, true)
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    slow.resolve(listed([A, B]))
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(3)
  })
})

describe('InstancesPanel back online', () => {
  it('reads again right after a read cut short by going offline, without waiting for the next poll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stale = deferred<InstanceList>()
    list.mockReturnValueOnce(stale.promise)
    const w = mountPanel()
    expect(list).toHaveBeenCalledTimes(1)
    await w.setProps({ device: device(false) })
    await w.setProps({ device: device(true) })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1) // still one read in flight
    stale.resolve(listed([A, B]))
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2) // no 5 s wait
    expect(rowsOf(w).map((r) => r.name)).toEqual(['alpha', 'beta'])
  })
})

describe('InstancesPanel rows without a meta (R14c)', () => {
  const acts = (w: VueWrapper, id: string) => w.findAll(`[data-row="${id}"] [data-act]`).map((b) => b.attributes('data-act'))

  it('offers neither 编辑 nor 删除… until the meta arrives, then follows the permission', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    metasApi.mockRejectedValueOnce(new Error('metas down'))
    const w = mountPanel()
    await flushPromises()
    expect(rowsOf(w).map((r) => r.id).sort()).toEqual([A, B].sort())
    expect(acts(w, A)).toEqual(['toggle'])
    expect(acts(w, B)).toEqual(['toggle'])

    // Next cycle: A may do anything, B is read-only and undeletable.
    metasApi.mockImplementation(async (_m, ids) =>
      Object.fromEntries(ids.map((id) => [id, id === A ? meta('alpha') : meta('beta', 3)])))
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(acts(w, A)).toEqual(['edit', 'toggle', 'delete'])
    expect(acts(w, B)).toEqual(['toggle'])
  })

  it('an edited instance keeps its cached meta while the meta is read again', async () => {
    configApi.mockResolvedValue({ instance_id: A, network_name: 'alpha', networking_method: 'Manual' })
    runApi.mockResolvedValue(undefined)
    const w = mountPanel()
    await flushPromises()
    expect(metasApi).toHaveBeenCalledTimes(1)
    await w.find(`[data-row="${A}"] [data-act="edit"]`).trigger('click')
    await flushPromises()
    metasApi.mockRejectedValueOnce(new Error('metas down'))
    await w.find('[data-dialog] [data-action="save"]').trigger('click')
    await flushPromises()
    expect(runApi).toHaveBeenCalledTimes(1)
    // The read after the save asked for A's meta again; it failed, so the cached one still counts.
    expect(metasApi).toHaveBeenCalledTimes(2)
    expect(metasApi.mock.calls[1]![1]).toEqual([A])
    expect(rowsOf(w).find((r) => r.id === A)!.name).toBe('alpha')
    expect(acts(w, A)).toEqual(['edit', 'toggle', 'delete'])
  })
})
