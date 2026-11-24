import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
import { instanceInfo, instanceMetas, listInstances, patchVpnPortalClients, vpnPortalInfo } from '../../src/api/client'
import type { InstanceMeta, InstanceRunningInfo } from '../../src/api/types'
import InstancesPanel from '../../src/components/instances/InstancesPanel.vue'
import VpnPortalDialog from '../../src/components/instances/VpnPortalDialog.vue'
import { confirmQueue, settleConfirm } from '../../src/composables/useConfirm'
import { toasts } from '../../src/composables/useToast'
import type { DeviceView } from '../../src/domain/devices'
import type { InstanceRow } from '../../src/domain/instances'
import { i18n } from '../../src/i18n'
import { normalizeVpnPortalInfo, type VpnPortalInfo } from '../../src/lib/networkConfig'

vi.mock('../../src/api/client', () => ({
  deleteInstance: vi.fn(),
  generateToml: vi.fn(),
  getInstanceConfig: vi.fn(),
  instanceInfo: vi.fn(),
  instanceMetas: vi.fn(),
  listInstances: vi.fn(),
  parseToml: vi.fn(),
  patchVpnPortalClients: vi.fn(),
  runInstance: vi.fn(),
  saveInstanceConfig: vi.fn(),
  setInstanceDisabled: vi.fn(),
  vpnPortalInfo: vi.fn(),
}))

const portalApi = vi.mocked(vpnPortalInfo)
const patchApi = vi.mocked(patchVpnPortalClients)

const A = '5eed0000-0000-4000-8000-00000000000a'
const B = '5eed0000-0000-4000-8000-00000000000b'

/** The instance at 10.88.0.3/24. */
const INFO: InstanceRunningInfo = {
  running: true,
  my_node_info: { virtual_ipv4: { address: { addr: 0x0a580003 }, network_length: 24 } },
}

/** A 2.7 portal with one connected client. */
function portal(name = 'phone', address = '10.88.0.20'): VpnPortalInfo {
  return normalizeVpnPortalInfo({
    vpn_type: 'wireguard',
    listener: 'wg://0.0.0.0:22022',
    clients: [{ name, virtual_ip: `${address}/24`, state: 'VPN_PORTAL_CLIENT_STATE_ONLINE', client_config: '[Peer]\nEndpoint = 0.0.0.0:22022\n' }],
  })
}

function row(id: string, name: string): InstanceRow {
  return { id, name, state: 'running', errorMsg: null, ipv4: '10.88.0.3/24', local: false, editable: true, deletable: true }
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

const text = () => document.body.textContent ?? ''
const button = (label: string) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined
function field(label: string): HTMLInputElement {
  const l = Array.from(document.body.querySelectorAll('label')).find((x) => x.textContent?.trim() === label)!
  return document.getElementById(l.htmlFor) as HTMLInputElement
}
async function type(label: string, value: string) {
  const input = field(label)
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}
const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const OFFLINE = () => i18n.global.t('instances.offline')

const wrappers: VueWrapper[] = []

function mountDialog(props: Record<string, unknown> = {}) {
  const w = mount(VpnPortalDialog, {
    props: { machineId: 'm1', row: row(A, 'alpha'), info: INFO, coreVersion: '2.7.1', online: true, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
  vi.resetAllMocks()
  portalApi.mockResolvedValue(portal())
  patchApi.mockResolvedValue(undefined)
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
  confirmQueue.splice(0)
  toasts.splice(0)
  i18n.global.locale.value = 'en'
})

describe('VpnPortalDialog sends nothing to an offline device (R14)', () => {
  it('reads nothing while the device is offline, and reads once it is back', async () => {
    const w = mountDialog({ online: false })
    await flushPromises()
    expect(portalApi).not.toHaveBeenCalled()
    expect(text()).toContain(OFFLINE())

    await w.setProps({ online: true })
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(1)
    expect(portalApi).toHaveBeenCalledWith('m1', A)
    expect(text()).toContain('phone')
  })

  it('keeps what was typed but disables 添加 and 删除 once the device is offline; a submit sends nothing', async () => {
    const w = mountDialog()
    await flushPromises()
    await type('名称', 'tablet')
    expect(button('添加')!.disabled).toBe(false)

    await w.setProps({ online: false })
    expect(text()).toContain(OFFLINE())
    expect(button('添加')!.disabled).toBe(true)
    expect(button('删除')!.disabled).toBe(true)
    expect(field('名称').value).toBe('tablet')
    expect(field('名称').disabled).toBe(false)
    document.body.querySelector('form')!.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(patchApi).not.toHaveBeenCalled()
  })

  it('sends no REMOVE when the device went offline while the confirm was open', async () => {
    const w = mountDialog()
    await flushPromises()
    button('删除')!.click()
    await flushPromises()
    expect(confirmQueue).toHaveLength(1)

    await w.setProps({ online: false })
    settleConfirm(confirmQueue[0]!.id, true)
    await flushPromises()
    expect(patchApi).not.toHaveBeenCalled()
    expect(toasts.map((t) => t.message)).toContain(OFFLINE())
  })
})

describe('VpnPortalDialog patches', () => {
  it('stays open while a patch is in flight, then reads the portal again', async () => {
    const sent = deferred<void>()
    patchApi.mockReturnValue(sent.promise)
    const w = mountDialog()
    await flushPromises()
    button('添加')!.click()
    await flushPromises()
    expect(patchApi).toHaveBeenCalledWith('m1', A, [
      { action: 'ADD', client: { name: 'client-1', virtual_ip: '10.88.0.1/24', groups: [] } },
    ])
    expect(button('关闭')!.disabled).toBe(true)
    pressEscape()
    await flushPromises()
    expect(w.emitted('close')).toBeUndefined()

    sent.resolve()
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(2)
    expect(button('关闭')!.disabled).toBe(false)
    button('关闭')!.click()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('moves the defaults on after an add, even when the read after it fails', async () => {
    portalApi.mockResolvedValueOnce(portal()).mockRejectedValueOnce(new Error('rpc timeout'))
    mountDialog()
    await flushPromises()
    expect(field('名称').value).toBe('client-1')
    expect(field('地址').value).toBe('10.88.0.1')
    button('添加')!.click()
    await flushPromises()

    expect(text()).toContain('client-1')
    expect(field('名称').value).toBe('client-2')
    expect(field('地址').value).toBe('10.88.0.2')
    expect(text()).toContain(i18n.global.t('vpn.loadFailed'))
  })
})

// --- through the panel ---

const RowStub = defineComponent({
  name: 'InstanceRowView',
  props: { row: { type: Object as PropType<InstanceRow>, required: true }, card: Boolean, busy: Boolean },
  emits: ['edit', 'vpn', 'toggle', 'export', 'delete'],
  setup(props, { emit }) {
    return () => h('tr', [h('td', [h('button', { 'data-vpn': props.row.id, onClick: () => emit('vpn') })])])
  },
})

function device(): DeviceView {
  return {
    id: 'm1', name: 'core2', hostname: 'core2', alias: null, os: 'linux',
    online: true, lastSeen: null, version: '2.7.1', outdated: false,
    publicIp: null, location: null, knownLocation: null, locationCached: false,
    networks: [], defaultNetworkId: null, member: null, ip: null, pending: false,
  }
}

describe('InstancesPanel VPN Portal openings', () => {
  it('never shows an answer meant for an earlier opening, for another instance, in a later one', async () => {
    vi.mocked(listInstances).mockResolvedValue({ running: [A, B], disabled: [] })
    vi.mocked(instanceMetas).mockImplementation(async (_m, ids) =>
      Object.fromEntries(ids.map((id) => [id, { networkName: id === A ? 'alpha' : 'beta', permission: 0 } as InstanceMeta])),
    )
    vi.mocked(instanceInfo).mockResolvedValue(INFO)
    const late = deferred<VpnPortalInfo>()
    portalApi.mockImplementation((_m, id) => (id === A ? late.promise : Promise.resolve(portal('tablet', '10.88.0.30'))))
    const w = mount(InstancesPanel, {
      props: { device: device(), centralIds: [] },
      global: { plugins: [i18n], stubs: { InstanceRowView: RowStub, ConfigEditorDialog: true } },
      attachTo: document.body,
    })
    wrappers.push(w)
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>(`[data-vpn="${A}"]`)!.click()
    await flushPromises()
    expect(text()).toContain('VPN Portal · alpha')
    button('关闭')!.click()
    await flushPromises()
    expect(text()).not.toContain('VPN Portal · alpha')

    document.body.querySelector<HTMLButtonElement>(`[data-vpn="${B}"]`)!.click()
    await flushPromises()
    expect(text()).toContain('VPN Portal · beta')
    expect(text()).toContain('tablet')

    late.resolve(portal('phone'))
    await flushPromises()
    expect(text()).toContain('tablet')
    expect(text()).not.toContain('phone')
    expect(portalApi.mock.calls).toEqual([['m1', A], ['m1', B]])
  })
})
