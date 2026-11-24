import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
import {
  deleteInstance,
  instanceInfo,
  instanceMetas,
  listInstances,
  saveInstanceConfig,
  setInstanceDisabled,
} from '../../src/api/client'
import type { InstanceList, InstanceMeta, InstanceRunningInfo } from '../../src/api/types'
import InstancesPanel from '../../src/components/instances/InstancesPanel.vue'
import { confirmQueue, settleConfirm } from '../../src/composables/useConfirm'
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

const A = '5eed0000-0000-4000-8000-00000000000a'
const B = '5eed0000-0000-4000-8000-00000000000b'

const RUNNING: InstanceRunningInfo = {
  running: true,
  my_node_info: { virtual_ipv4: { address: { addr: 0x0a580003 }, network_length: 24 } },
}

function meta(name: string): InstanceMeta {
  return { networkName: name, instanceName: name, source: 'web', permission: 0 } as InstanceMeta
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
          h('button', { 'data-act': 'toggle', onClick: () => emit('toggle') }),
          h('button', { 'data-act': 'delete', onClick: () => emit('delete') }),
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
  },
  emits: ['action', 'update:open'],
  setup(props, { emit }) {
    return () =>
      props.open
        ? h(
            'div',
            { 'data-dialog': '' },
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
