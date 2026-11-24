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
import { normalizeVpnPortalInfo, VpnPortalClientState, type VpnPortalInfo } from '../../src/lib/networkConfig'

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
const CLIENT_NAME = /^client-[0-9a-f]{8}$/

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
  vi.useRealTimers()
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
    const name = field('名称').value
    button('添加')!.click()
    await flushPromises()
    expect(patchApi).toHaveBeenCalledWith('m1', A, [
      { action: 'ADD', client: { name, virtual_ip: '10.88.0.1/24', groups: [] } },
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
    const first = field('名称').value
    expect(first).toMatch(CLIENT_NAME)
    expect(field('地址').value).toBe('10.88.0.1')
    button('添加')!.click()
    await flushPromises()

    expect(text()).toContain(first)
    const second = field('名称').value
    expect(second).toMatch(CLIENT_NAME)
    expect(second).not.toBe(first)
    expect(field('地址').value).toBe('10.88.0.2')
    expect(text()).toContain(i18n.global.t('vpn.loadFailed'))
  })
})

describe('VpnPortalDialog default client name (R15)', () => {
  it('suggests client- and 8 random hex characters, never a recycled name, and says what a name means', async () => {
    mountDialog()
    await flushPromises()
    const first = field('名称').value
    expect(first).toMatch(CLIENT_NAME)
    expect(text()).toContain('名称决定客户端的密钥：再次添加删除过的名称，会恢复原来那份配置的访问权限。')

    // Removing a client and adding again never brings its name back as the default.
    button('删除')!.click()
    await flushPromises()
    settleConfirm(confirmQueue[0]!.id, true)
    await flushPromises()
    expect(patchApi).toHaveBeenLastCalledWith('m1', A, [{ action: 'REMOVE', client: { name: 'phone', virtual_ip: '', groups: [] } }])
    portalApi.mockResolvedValue(normalizeVpnPortalInfo({ vpn_type: 'wireguard', listener: 'wg://0.0.0.0:22022', clients: [] }))
    button('添加')!.click()
    await flushPromises()
    expect(patchApi).toHaveBeenLastCalledWith('m1', A, [{ action: 'ADD', client: { name: first, virtual_ip: '10.88.0.1/24', groups: [] } }])
    const second = field('名称').value
    expect(second).toMatch(CLIENT_NAME)
    expect(second).not.toBe(first)
  })
})

describe('VpnPortalDialog while the instance network is unknown (R16b)', () => {
  /** A running DHCP instance that has no virtual IP yet. */
  const NO_IP: InstanceRunningInfo = { running: true, my_node_info: {} }
  const NETWORK_UNKNOWN = '实例还没有虚拟 IP，暂时不能添加客户端'

  it('disables 添加 and sends nothing, then suggests an address once the network is known', async () => {
    const w = mountDialog({ info: NO_IP })
    await flushPromises()
    expect(text()).toContain('phone')
    expect(text()).toContain(NETWORK_UNKNOWN)
    expect(field('地址').value).toBe('')
    expect(button('添加')!.disabled).toBe(true)
    // An address outside 10.88.0.0/24 is no less refused while the network is unknown.
    await type('地址', '192.168.1.5')
    await type('前缀', '24')
    expect(button('添加')!.disabled).toBe(true)
    document.body.querySelector('form')!.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(patchApi).not.toHaveBeenCalled()

    // The typed address stays when the network turns up; an untouched form gets the suggestion.
    await w.setProps({ info: INFO })
    expect(text()).not.toContain(NETWORK_UNKNOWN)
    expect(field('地址').value).toBe('192.168.1.5')
    expect(button('添加')!.disabled).toBe(true)
    await type('地址', '')
    await type('前缀', '')
    await w.setProps({ info: NO_IP })
    await w.setProps({ info: INFO })
    expect(field('地址').value).toBe('10.88.0.1')
    expect(field('前缀').value).toBe('24')
    expect(button('添加')!.disabled).toBe(false)
  })

  it('applies the suggestion when the network arrives after the first read', async () => {
    const w = mountDialog({ info: NO_IP })
    await flushPromises()
    expect(field('地址').value).toBe('')
    expect(field('前缀').value).toBe('')
    await w.setProps({ info: INFO })
    expect(field('地址').value).toBe('10.88.0.1')
    expect(field('前缀').value).toBe('24')
    expect(button('添加')!.disabled).toBe(false)
  })

  it('disables 添加 again when the info goes away while the dialog is open, keeping what was typed', async () => {
    const w = mountDialog()
    await flushPromises()
    expect(button('添加')!.disabled).toBe(false)
    await w.setProps({ info: null })
    expect(text()).toContain(NETWORK_UNKNOWN)
    expect(button('添加')!.disabled).toBe(true)
    expect(field('地址').value).toBe('10.88.0.1')
    document.body.querySelector('form')!.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(patchApi).not.toHaveBeenCalled()
  })
})

describe('VpnPortalDialog polls while open (F3)', () => {
  /** phone as it was before its device connected. */
  const waiting = () => {
    const p = portal()
    p.clients[0]!.state = VpnPortalClientState.OFFLINE
    return p
  }
  const phoneState = () => document.body.querySelector('[data-testid="vpn-client"]')?.textContent ?? ''

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  it('reads again after 5 s, so a client that connects shows as 已连接; what is typed stays', async () => {
    portalApi.mockResolvedValueOnce(waiting()).mockResolvedValue(portal())
    mountDialog()
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(1)
    expect(phoneState()).toContain('未连接')
    await type('名称', 'tablet')
    await type('地址', '10.88.0.40')

    await vi.advanceTimersByTimeAsync(4_999)
    expect(portalApi).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(2)
    expect(portalApi).toHaveBeenLastCalledWith('m1', A)
    expect(phoneState()).toContain('已连接')
    expect(field('名称').value).toBe('tablet')
    expect(field('地址').value).toBe('10.88.0.40')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(portalApi).toHaveBeenCalledTimes(3)
  })

  it('sends nothing while the device is offline, and reads once it is back', async () => {
    const w = mountDialog()
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(1)

    await w.setProps({ online: false })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(portalApi).toHaveBeenCalledTimes(1)

    // The state after the outage, at once rather than at the next tick.
    portalApi.mockResolvedValue(portal('tablet', '10.88.0.30'))
    await w.setProps({ online: true })
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(2)
    expect(text()).toContain('tablet')
    expect(text()).not.toContain('phone')
  })

  it('skips the ticks while a patch is pending; the patch reads again itself', async () => {
    const sent = deferred<void>()
    patchApi.mockReturnValue(sent.promise)
    mountDialog()
    await flushPromises()
    button('添加')!.click()
    await flushPromises()
    expect(patchApi).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(portalApi).toHaveBeenCalledTimes(1)

    sent.resolve()
    await flushPromises()
    expect(portalApi).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(portalApi).toHaveBeenCalledTimes(3)
  })

  it('never has two reads in flight: a slow read holds the next tick back', async () => {
    mountDialog()
    await flushPromises()
    const slow = deferred<VpnPortalInfo>()
    portalApi.mockReturnValueOnce(slow.promise)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(portalApi).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(portalApi).toHaveBeenCalledTimes(2)

    slow.resolve(portal())
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(portalApi).toHaveBeenCalledTimes(3)
  })

  it('stops reading once closed', async () => {
    const w = mountDialog()
    await flushPromises()
    w.unmount()
    wrappers.splice(wrappers.indexOf(w), 1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(portalApi).toHaveBeenCalledTimes(1)
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
