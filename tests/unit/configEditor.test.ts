import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import fixture from '../fixtures/v2.7.1/instance-config-core2.json'
import parseOk from '../fixtures/v2.7.1/parse-config-ok.json'
import { generateToml, parseToml } from '../../src/api/client'
import { ApiError } from '../../src/api/http'
import ConfigEditor from '../../src/components/config-editor/ConfigEditor.vue'
import ConfigEditorDialog from '../../src/components/config-editor/ConfigEditorDialog.vue'
import { proxyCidrRule } from '../../src/components/config-editor/rules'
import { LEGACY_VPN_FIELDS, splitLegacyVpn } from '../../src/domain/vpnPortal'
import { i18n } from '../../src/i18n'
import { normalizeNetworkConfig, toBackendNetworkConfig, type NetworkConfig } from '../../src/lib/networkConfig'

vi.mock('../../src/api/client', () => ({
  generateToml: vi.fn(),
  parseToml: vi.fn(),
}))

const gen = vi.mocked(generateToml)
const parse = vi.mocked(parseToml)

const TOML = 'network_name = "lab-manual"\n'

function input(change?: (raw: Record<string, unknown>) => void): NetworkConfig {
  const raw = structuredClone(fixture) as Record<string, unknown>
  change?.(raw)
  return normalizeNetworkConfig(raw as unknown as NetworkConfig)
}

function withoutLegacy(raw: Record<string, unknown>) {
  for (const k of LEGACY_VPN_FIELDS) delete raw[k]
}

const wrappers: VueWrapper[] = []

function mountEditor(props: { modelValue: NetworkConfig; mode?: 'member' | 'instance'; coreVersion?: string }) {
  const w = mount(ConfigEditor, {
    props: { mode: 'instance', coreVersion: '2.6.4', ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

function lastDraft(w: VueWrapper): NetworkConfig {
  const all = w.emitted('update:modelValue') as [NetworkConfig][] | undefined
  expect(all?.length, 'update:modelValue was emitted').toBeTruthy()
  return all!.at(-1)![0]
}

function lastValid(w: VueWrapper): boolean | undefined {
  return (w.emitted('update:valid') as [boolean][] | undefined)?.at(-1)?.[0]
}

/** The control a `<label>` with exactly this text names, through `for` or by nesting. */
function control(root: VueWrapper | DOMWrapper<Element>, text: string): DOMWrapper<HTMLInputElement> {
  const label = root.findAll('label').find((l) => l.text().trim() === text)
  expect(label, `label "${text}"`).toBeTruthy()
  const id = label!.attributes('for')
  const el = id ? root.find<HTMLInputElement>(`[id="${id}"]`) : label!.find<HTMLInputElement>('input, select, textarea')
  expect(el.exists(), `control for "${text}"`).toBe(true)
  return el
}

function flushOf(w: VueWrapper): () => Promise<NetworkConfig | null> {
  return (w.vm as unknown as { flush(): Promise<NetworkConfig | null> }).flush
}

function hasLabel(root: VueWrapper | DOMWrapper<Element>, text: string): boolean {
  return root.findAll('label').some((l) => l.text().trim() === text)
}

function section(w: VueWrapper, name: string) {
  return w.find(`[data-section="${name}"]`)
}

function tab(w: VueWrapper, text: string) {
  const t = w.findAll('[role="tab"]').find((b) => b.text().trim() === text)
  expect(t, `tab "${text}"`).toBeTruthy()
  return t!
}

async function openToml(w: VueWrapper) {
  await tab(w, 'TOML').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
  gen.mockReset()
  parse.mockReset()
  gen.mockResolvedValue({ toml: TOML })
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount()
  i18n.global.locale.value = 'en'
})

describe('ConfigEditor form', () => {
  it('editing the MTU changes nothing else', async () => {
    const value = input()
    const w = mountEditor({ modelValue: value })
    await control(w, 'MTU').setValue('1300')

    const draft = lastDraft(w)
    expect(draft.mtu).toBe(1300)
    expect({ ...draft, mtu: null }).toStrictEqual({ ...value, mtu: null })
  })

  it('an unset flag shows its default and is removed when set back to it', async () => {
    const w = mountEditor({ modelValue: input((raw) => delete raw.multi_thread) })
    const box = control(section(w, 'flags'), '启用多线程')
    expect(box.element.checked).toBe(true)

    await box.setValue(false)
    expect(lastDraft(w).multi_thread).toBe(false)

    await box.setValue(true)
    expect('multi_thread' in lastDraft(w)).toBe(false)
  })

  it('the network section only shows for instances', () => {
    expect(section(mountEditor({ modelValue: input(), mode: 'member' }), 'network').exists()).toBe(false)
    const w = mountEditor({ modelValue: input(), mode: 'instance' })
    expect(section(w, 'network').exists()).toBe(true)
    expect(control(section(w, 'network'), '网络名').element.value).toBe('lab-manual')
  })

  it('a static instance may have no virtual IP, as the core allows', async () => {
    // A core reads back `virtual_ipv4` / `network_length` only when the node has an address (a relay
    // has none), so such an instance arrives as `dhcp: false` with neither field.
    const value = input((raw) => { delete raw.virtual_ipv4; delete raw.network_length })
    const w = mountEditor({ modelValue: value })
    const net = section(w, 'network')
    expect(lastValid(w)).toBe(true)
    expect(net.text()).not.toContain('必填')
    const flush = (w.vm as unknown as { flush(): Promise<NetworkConfig | null> }).flush
    await expect(flush()).resolves.toStrictEqual(value)

    // An address that is there must be one; a blank prefix length means the core's default of 24.
    await control(net, '虚拟 IPv4').setValue('10.88.0')
    expect(lastValid(w)).toBe(false)
    expect(net.text()).toContain('请输入 IPv4 地址')
    await control(net, '虚拟 IPv4').setValue('10.88.0.9')
    expect(lastValid(w)).toBe(true)
    await control(net, '前缀长度').setValue('40')
    expect(lastValid(w)).toBe(false)
    expect(net.text()).toContain('前缀长度范围 1–32')
    await control(net, '前缀长度').setValue('16')
    expect(lastDraft(w)).toMatchObject({ virtual_ipv4: '10.88.0.9', network_length: 16 })

    // Clearing both again gives back the config as read.
    await control(net, '前缀长度').setValue('')
    await control(net, '虚拟 IPv4').setValue('')
    expect(lastValid(w)).toBe(true)
    expect(lastDraft(w)).toStrictEqual(value)
  })

  it('a subnet proxy entry is a CIDR or a mapped <cidr>-><cidr>', () => {
    for (const ok of ['10.1.0.0/24', '10.1.0.0/24->10.2.0.0/24']) expect(proxyCidrRule(ok), ok).toBeNull()
    expect(proxyCidrRule('')).toBe('required')
    // The core does not trim, and web v2.7.1 generate-config rejects a padded entry.
    for (const bad of ['10.1.0.0/24->bad', '10.1.0.0/24->', '->10.2.0.0/24', '10.1.0.0/24->10.2.0.0/24->10.3.0.0/24', '10.1.0.0/24 -> 10.2.0.0/24', ' 10.1.0.0/24']) {
      expect(proxyCidrRule(bad), bad).toBe('cidr')
    }
  })

  it('an instance with a mapped subnet proxy stays valid and saves it unchanged', async () => {
    const value = input((raw) => { raw.proxy_cidrs = ['10.1.0.0/24->10.2.0.0/24', '192.168.5.0/24'] })
    const w = mountEditor({ modelValue: value })
    const net = section(w, 'network')
    expect(lastValid(w)).toBe(true)
    expect(net.text()).not.toContain('请输入 CIDR')

    // An unrelated edit saves, with the mapped entry as read.
    await control(w, 'MTU').setValue('1300')
    expect(lastValid(w)).toBe(true)
    await expect(flushOf(w)()).resolves.toStrictEqual({ ...value, mtu: 1300 })

    const entry = net.find<HTMLInputElement>('input[aria-label="子网代理 第 1 项"]')
    for (const bad of ['10.1.0.0/24->bad', '10.1.0.0/24->']) {
      await entry.setValue(bad)
      expect(lastValid(w), bad).toBe(false)
      expect(net.text()).toContain('请输入 CIDR，例如 10.0.0.0/24')
    }
    await entry.setValue('10.1.0.0/24->10.2.0.0/24')
    expect(lastValid(w)).toBe(true)
    expect(lastDraft(w)).toStrictEqual({ ...value, mtu: 1300 })
  })

  it('with a DHCP range and no dhcp key, 自动分配 IP shows on, as the core runs it', async () => {
    // Upstream: dhcp.unwrap_or(dhcp_ipv4_cidr.is_some()).
    const value = input((raw) => { delete raw.dhcp; raw.dhcp_ipv4_cidr = '10.88.0.0/24' })
    const w = mountEditor({ modelValue: value })
    const net = section(w, 'network')
    const box = control(net, '自动分配 IP')
    expect(box.element.checked).toBe(true)
    expect(hasLabel(net, '虚拟 IPv4')).toBe(false)
    await expect(flushOf(w)()).resolves.toStrictEqual(value)

    // Off has to be written out, or the core keeps DHCP on and ignores the static address.
    await box.setValue(false)
    expect(lastDraft(w).dhcp).toBe(false)
    expect(control(net, '虚拟 IPv4').element.value).toBe('10.88.0.3')

    await box.setValue(true)
    expect('dhcp' in lastDraft(w)).toBe(false)
    expect(lastDraft(w)).toStrictEqual(value)
  })

  it('without a DHCP range and no dhcp key, 自动分配 IP shows off', async () => {
    const value = input((raw) => delete raw.dhcp)
    const w = mountEditor({ modelValue: value })
    const net = section(w, 'network')
    const box = control(net, '自动分配 IP')
    expect(box.element.checked).toBe(false)
    expect(control(net, '虚拟 IPv4').element.value).toBe('10.88.0.3')
    await expect(flushOf(w)()).resolves.toStrictEqual(value)

    await box.setValue(true)
    expect(lastDraft(w).dhcp).toBe(true)
    expect(hasLabel(net, '虚拟 IPv4')).toBe(false)

    await box.setValue(false)
    expect('dhcp' in lastDraft(w)).toBe(false)
    expect(lastDraft(w)).toStrictEqual(value)
  })

  it('checks the static address only while DHCP is effectively off', async () => {
    const w = mountEditor({ modelValue: input((raw) => { delete raw.dhcp; raw.dhcp_ipv4_cidr = '10.88.0.0/24'; raw.network_length = 40 }) })
    expect(lastValid(w)).toBe(true)

    const net = section(w, 'network')
    await control(net, '自动分配 IP').setValue(false)
    expect(lastValid(w)).toBe(false)
    expect(net.text()).toContain('前缀长度范围 1–32')
  })

  it('a port outside 1–65535 makes the draft invalid', async () => {
    const w = mountEditor({ modelValue: input() })
    expect(lastValid(w)).toBe(true)
    const pf = section(w, 'portForwards')
    await control(pf, '本地端口').setValue('70000')

    expect(lastValid(w)).toBe(false)
    expect(pf.text()).toContain('端口范围 1–65535')
  })

  it('the encryption switch writes disable_encryption and locks the algorithm', async () => {
    const w = mountEditor({ modelValue: input((raw) => delete raw.disable_encryption) })
    const crypto = section(w, 'crypto')
    await control(crypto, '加密').setValue(false)

    expect(lastDraft(w).disable_encryption).toBe(true)
    expect(control(crypto, '加密算法').attributes('disabled')).toBeDefined()
  })

  it('clearing the DNS domain removes only the domain', async () => {
    const w = mountEditor({ modelValue: input((raw) => { raw.dns = { domain: 'lab.et', zone: [{ origin: 'x.', records: [] }] } }) })
    await control(section(w, 'dns'), '域名').setValue('')

    expect(lastDraft(w).dns).toEqual({ zone: [{ origin: 'x.', records: [] }] })
  })
})

describe('ConfigEditor TOML', () => {
  it('generates the TOML from the backend form of the draft and shows it', async () => {
    const value = input()
    const w = mountEditor({ modelValue: value })
    await openToml(w)

    expect(gen).toHaveBeenCalledExactlyOnceWith(toBackendNetworkConfig(splitLegacyVpn(value).rest))
    expect(w.find('textarea').element.value).toBe(TOML)
    expect(tab(w, 'TOML').attributes('aria-selected')).toBe('true')
  })

  it('a TOML that does not parse keeps the TOML tab and makes the editor invalid', async () => {
    parse.mockResolvedValue({ error: 'bad' })
    const w = mountEditor({ modelValue: input() })
    await openToml(w)
    await w.find('textarea').setValue('network_name = [')
    await tab(w, '表单').trigger('click')
    await flushPromises()

    expect(parse).toHaveBeenCalledWith('network_name = [')
    expect(tab(w, 'TOML').attributes('aria-selected')).toBe('true')
    expect(w.find('textarea').element.value).toBe('network_name = [')
    expect(w.text()).toContain('无法解析：bad')
    expect(lastValid(w)).toBe(false)
  })

  it('a parsed TOML becomes the draft, keeping the instance id', async () => {
    parse.mockResolvedValue({ config: { ...parseOk.config, instance_id: 'aaaaaaaa-0000-4000-8000-000000000000', mtu: 1200 } })
    const value = input()
    const w = mountEditor({ modelValue: value })
    await openToml(w)
    await w.find('textarea').setValue('mtu = 1200\n')
    await tab(w, '表单').trigger('click')
    await flushPromises()

    const draft = lastDraft(w)
    expect(draft.mtu).toBe(1200)
    expect(draft.instance_id).toBe(value.instance_id)
    expect(tab(w, '表单').attributes('aria-selected')).toBe('true')
    expect(control(w, 'MTU').element.value).toBe('1200')
  })

  it('flush() resolves to null while the TOML does not parse', async () => {
    parse.mockResolvedValue({ error: 'bad' })
    const w = mountEditor({ modelValue: input() })
    await openToml(w)
    await w.find('textarea').setValue('network_name = [')

    const flush = (w.vm as unknown as { flush(): Promise<NetworkConfig | null> }).flush
    await expect(flush()).resolves.toBeNull()
  })

  it('flush() returns the draft when nothing changed in the TOML', async () => {
    const value = input()
    const w = mountEditor({ modelValue: value })
    await openToml(w)

    const flush = (w.vm as unknown as { flush(): Promise<NetworkConfig | null> }).flush
    await expect(flush()).resolves.toStrictEqual(value)
    expect(parse).not.toHaveBeenCalled()
  })

  it('a failed parse request keeps the text and shows the error', async () => {
    parse.mockRejectedValue(new ApiError(500, null, 'backend down'))
    const w = mountEditor({ modelValue: input() })
    await openToml(w)
    await w.find('textarea').setValue('mtu = 1300\n')
    await tab(w, '表单').trigger('click')
    await flushPromises()

    expect(w.find('textarea').element.value).toBe('mtu = 1300\n')
    expect(w.text()).toContain('backend down')
    expect(lastValid(w)).toBe(false)
  })

  it('a generate error offers the way back to the form', async () => {
    gen.mockResolvedValue({ error: 'no networking method' })
    const w = mountEditor({ modelValue: input() })
    await openToml(w)

    expect(w.text()).toContain('no networking method')
    const back = w.findAll('button').find((b) => b.text().trim() === '回到表单')!
    await back.trigger('click')
    expect(tab(w, '表单').attributes('aria-selected')).toBe('true')
  })

  it('member mode explains that central fields are ignored', async () => {
    const w = mountEditor({ modelValue: input(), mode: 'member' })
    await openToml(w)
    expect(w.text()).toContain('网络名、密钥、组网方式、IP、主机名、ACL 由中央网络管理，这里的修改会被忽略。')
  })
})

describe('ConfigEditor VPN portal (legacy cores)', () => {
  it('a 2.6 core edits the legacy fields', async () => {
    const w = mountEditor({ modelValue: input(), coreVersion: '2.6.4' })
    const vpn = section(w, 'vpnPortal')
    expect(vpn.text()).toContain('这台设备的 core 早于 2.7')
    expect(vpn.findAll('label').some((l) => l.text().trim() === '客户端')).toBe(false)
    expect(control(vpn, '客户端网段').element.value).toBe('10.88.1.0/24')

    await control(vpn, '监听端口').setValue('30000')
    expect(lastDraft(w).vpn_portal_listen_port).toBe(30000)

    await control(vpn, '客户端网段').setValue('10.77.0.0/16')
    const draft = lastDraft(w)
    expect(draft.vpn_portal_client_network_addr).toBe('10.77.0.0')
    expect(draft.vpn_portal_client_network_len).toBe(16)

    await control(vpn, '客户端网段').setValue('10.77.0.0')
    expect(lastValid(w)).toBe(false)
  })

  it('enabling the legacy portal fills in defaults; disabling again changes nothing', async () => {
    const value = input(withoutLegacy)
    const w = mountEditor({ modelValue: value, coreVersion: '2.6.4' })
    const vpn = section(w, 'vpnPortal')
    await control(vpn, '启用').setValue(true)
    expect(lastDraft(w)).toMatchObject({
      enable_vpn_portal: true,
      vpn_portal_listen_port: 22022,
      vpn_portal_client_network_addr: '10.14.14.0',
      vpn_portal_client_network_len: 24,
    })

    // Off is the switch's default, so the field goes; the port and network it hides go back to how
    // they were read, which here is absent.
    await control(vpn, '启用').setValue(false)
    const off = lastDraft(w)
    expect(off).toStrictEqual(value)
    expect(toBackendNetworkConfig(off)).toStrictEqual(toBackendNetworkConfig(value))
    expect(control(vpn, '启用').element.checked).toBe(false)
  })

  it('disabling the legacy portal puts back the port and network as read', async () => {
    const value = input()
    const w = mountEditor({ modelValue: value, coreVersion: '2.6.4' })
    const vpn = section(w, 'vpnPortal')
    await control(vpn, '监听端口').setValue('30000')
    await control(vpn, '客户端网段').setValue('10.77.0.0/16')
    await control(vpn, '启用').setValue(false)

    expect(lastDraft(w)).toStrictEqual(input((raw) => delete raw.enable_vpn_portal))

    await control(vpn, '启用').setValue(true)
    expect(lastDraft(w)).toStrictEqual(value)
    expect(control(vpn, '监听端口').element.value).toBe('22022')
    expect(control(vpn, '客户端网段').element.value).toBe('10.88.1.0/24')
  })

  it('a new config from the parent becomes what disabling the legacy portal goes back to', async () => {
    const w = mountEditor({ modelValue: input(withoutLegacy), coreVersion: '2.6.4' })
    const next = input((raw) => { raw.vpn_portal_listen_port = 30000 })
    await w.setProps({ modelValue: next })
    await control(section(w, 'vpnPortal'), '启用').setValue(false)

    expect(lastDraft(w)).toMatchObject({ vpn_portal_listen_port: 30000, vpn_portal_client_network_addr: '10.88.1.0' })
  })

  it('generates TOML without the legacy fields', async () => {
    const w = mountEditor({ modelValue: input(), coreVersion: '2.6.4' })
    await openToml(w)

    const sent = gen.mock.calls[0]![0] as Record<string, unknown>
    for (const k of LEGACY_VPN_FIELDS) expect(sent).not.toHaveProperty(k)
    expect(w.text()).toContain('旧版 VPN Portal 设置（2.7 之前的 core 使用）不在 TOML 中显示，保存时会原样保留。')
  })

  it('a parsed TOML keeps the legacy values from before', async () => {
    parse.mockResolvedValue({ config: parseOk.config })
    const value = input()
    const w = mountEditor({ modelValue: value, coreVersion: '2.6.4' })
    await openToml(w)
    await w.find('textarea').setValue('mtu = 1200\n')
    await tab(w, '表单').trigger('click')
    await flushPromises()

    const draft = lastDraft(w) as unknown as Record<string, unknown>
    for (const k of LEGACY_VPN_FIELDS) expect(draft[k], k).toBe((value as unknown as Record<string, unknown>)[k])
  })

  it('a 2.7 core without legacy fields gets the named-client portal', async () => {
    const value = input(withoutLegacy)
    const w = mountEditor({ modelValue: value, coreVersion: '2.7.1' })
    const vpn = section(w, 'vpnPortal')
    expect(vpn.text()).not.toContain('这台设备的 core 早于 2.7')
    expect(vpn.findAll('label').some((l) => l.text().trim() === '监听端口')).toBe(false)

    await control(vpn, '启用').setValue(true)
    const cfg = lastDraft(w).vpn_portal_config!
    expect(cfg.wireguard_listen).toBe('0.0.0.0:22022')
    expect(cfg.wireguard_private_key).toBeTruthy()
    expect(control(vpn, '监听地址').element.value).toBe('0.0.0.0:22022')
    expect(vpn.text()).toContain('客户端')

    const add = vpn.findAll('button').find((b) => b.text().trim() === '添加')!
    await add.trigger('click')
    await control(vpn, '名称').setValue('phone')
    await control(vpn, '虚拟 IP').setValue('10.88.0.20')
    expect(lastValid(w)).toBe(false)
    await control(vpn, '虚拟 IP').setValue('10.88.0.20/24')
    await control(vpn, '分组').setValue('a, b')
    expect(lastValid(w)).toBe(true)
    expect(lastDraft(w).vpn_portal_config!.clients).toEqual([{ name: 'phone', virtual_ip: '10.88.0.20/24', groups: ['a', 'b'] }])

    // This used to leave `{ enabled: false, … }` with a fresh key behind. R10: the config had no
    // portal when the editor opened and 启用 created this one, so 关闭 returns to no portal at all.
    await control(vpn, '启用').setValue(false)
    expect('vpn_portal_config' in lastDraft(w)).toBe(false)
    expect(lastDraft(w)).toStrictEqual(value)
  })
})

describe('ConfigEditor VPN portal (2.7+ cores): 启用 toggled back returns to the config as read', () => {
  const PORTAL = {
    wireguard_listen: '0.0.0.0:22022',
    wireguard_private_key: 'cHJpdmF0ZS1rZXktZml4dHVyZS0wMDAwMDAwMDAwMDA=',
    clients: [{ name: 'phone', virtual_ip: '10.88.0.20/24', groups: ['a'] }],
  }

  it('a portal created by 启用 is removed again by 关闭', async () => {
    const value = input(withoutLegacy)
    expect('vpn_portal_config' in value).toBe(false)
    const w = mountEditor({ modelValue: value, coreVersion: '2.7.1' })
    const vpn = section(w, 'vpnPortal')
    await control(vpn, '启用').setValue(true)
    expect(lastDraft(w).vpn_portal_config).toBeTruthy()

    await control(vpn, '启用').setValue(false)
    const off = lastDraft(w)
    expect('vpn_portal_config' in off).toBe(false)
    expect(off).toStrictEqual(value)
    expect(toBackendNetworkConfig(off)).toStrictEqual(toBackendNetworkConfig(value))
    expect(control(vpn, '启用').element.checked).toBe(false)
    expect(lastValid(w)).toBe(true)
  })

  it('a portal read without `enabled` (= enabled) is disabled explicitly and comes back as read', async () => {
    const value = input((raw) => { withoutLegacy(raw); raw.vpn_portal_config = structuredClone(PORTAL) })
    expect('enabled' in value.vpn_portal_config!).toBe(false)
    const w = mountEditor({ modelValue: value, coreVersion: '2.7.1' })
    const vpn = section(w, 'vpnPortal')
    expect(control(vpn, '启用').element.checked).toBe(true)

    // Off keeps everything else, so the clients and key are there when it is turned on again.
    await control(vpn, '启用').setValue(false)
    expect(lastDraft(w).vpn_portal_config).toStrictEqual({ ...value.vpn_portal_config, enabled: false })

    await control(vpn, '启用').setValue(true)
    const on = lastDraft(w)
    expect('enabled' in on.vpn_portal_config!).toBe(false)
    expect(on).toStrictEqual(value)
    expect(toBackendNetworkConfig(on)).toStrictEqual(toBackendNetworkConfig(value))
  })

  it('a portal read as disabled is enabled explicitly and goes back to disabled', async () => {
    const value = input((raw) => { withoutLegacy(raw); raw.vpn_portal_config = { ...structuredClone(PORTAL), enabled: false } })
    const w = mountEditor({ modelValue: value, coreVersion: '2.7.1' })
    const vpn = section(w, 'vpnPortal')
    expect(control(vpn, '启用').element.checked).toBe(false)

    await control(vpn, '启用').setValue(true)
    expect(lastDraft(w).vpn_portal_config).toStrictEqual({ ...value.vpn_portal_config, enabled: true })

    await control(vpn, '启用').setValue(false)
    expect(lastDraft(w)).toStrictEqual(value)
  })

  it('a new config from the parent becomes what 关闭 goes back to', async () => {
    const w = mountEditor({ modelValue: input(withoutLegacy), coreVersion: '2.7.1' })
    const next = input((raw) => { withoutLegacy(raw); raw.vpn_portal_config = structuredClone(PORTAL) })
    await w.setProps({ modelValue: next })
    await control(section(w, 'vpnPortal'), '启用').setValue(false)

    expect(lastDraft(w).vpn_portal_config).toStrictEqual({ ...next.vpn_portal_config, enabled: false })
  })
})

describe('ConfigEditorDialog', () => {
  const button = (label: string) =>
    Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

  function mountDialog(props: Record<string, unknown> = {}) {
    const w = mount(ConfigEditorDialog, {
      props: {
        open: true,
        title: '高级配置',
        mode: 'instance',
        coreVersion: '2.6.4',
        initial: input(),
        busy: false,
        actions: [{ key: 'save', label: '保存' }],
        ...props,
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    wrappers.push(w)
    return w
  }

  it('emits the action with the flushed draft', async () => {
    const value = input()
    const w = mountDialog({ initial: value, note: '保存后实例会用新配置重新启动。' })
    await flushPromises()
    expect(document.body.textContent).toContain('保存后实例会用新配置重新启动。')
    button('保存')!.click()
    await flushPromises()

    const [[key, config]] = w.emitted('action') as [string, NetworkConfig][]
    expect(key).toBe('save')
    expect(config).toStrictEqual(value)
  })

  it('disables the actions while busy or invalid', async () => {
    const w = mountDialog({ busy: true })
    await flushPromises()
    expect(button('保存')!.disabled).toBe(true)

    await w.setProps({ busy: false })
    expect(button('保存')!.disabled).toBe(false)

    const mtu = document.body.querySelector<HTMLInputElement>('input[type="number"][placeholder="1380"]')!
    mtu.value = '100'
    mtu.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(button('保存')!.disabled).toBe(true)
  })

  it('saves a static instance that has no virtual IP', async () => {
    const value = input((raw) => { delete raw.virtual_ipv4; delete raw.network_length })
    const w = mountDialog({ initial: value })
    await flushPromises()
    expect(button('保存')!.disabled).toBe(false)
    button('保存')!.click()
    await flushPromises()

    expect(w.emitted('action')).toEqual([['save', value]])
  })

  const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const closes = (w: VueWrapper) => ((w.emitted('update:open') as [boolean][] | undefined) ?? []).filter(([v]) => v === false)

  it('refuses to close while busy: 取消 is disabled and Escape is ignored', async () => {
    const w = mountDialog({ busy: true })
    await flushPromises()
    expect(button('取消')!.disabled).toBe(true)
    button('取消')!.click()
    pressEscape()
    await flushPromises()
    expect(closes(w)).toEqual([])
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    await w.setProps({ busy: false })
    expect(button('取消')!.disabled).toBe(false)
    pressEscape()
    await flushPromises()
    expect(closes(w)).toEqual([[false]])
  })

  it('取消 closes when not busy', async () => {
    const w = mountDialog()
    await flushPromises()
    button('取消')!.click()
    await flushPromises()
    expect(closes(w)).toEqual([[false]])
  })

  it('refuses to close while the TOML is being parsed for an action', async () => {
    let finish!: (v: { config: Record<string, unknown> }) => void
    parse.mockReturnValue(new Promise((r) => { finish = r }))
    const w = mountDialog()
    await flushPromises()
    ;(Array.from(document.body.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim() === 'TOML') as HTMLElement).click()
    await flushPromises()
    const area = document.body.querySelector('textarea')!
    area.value = 'network_name = "x"\n'
    area.dispatchEvent(new Event('input'))
    await flushPromises()
    button('保存')!.click()
    await flushPromises()
    expect(parse).toHaveBeenCalled()

    expect(button('取消')!.disabled).toBe(true)
    pressEscape()
    await flushPromises()
    expect(closes(w)).toEqual([])

    finish({ config: parseOk.config })
    await flushPromises()
    expect(w.emitted('action')).toHaveLength(1)
    expect(button('取消')!.disabled).toBe(false)
    pressEscape()
    await flushPromises()
    expect(closes(w)).toEqual([[false]])
  })

  it('does not emit when the TOML does not parse', async () => {
    parse.mockResolvedValue({ error: 'bad' })
    const w = mountDialog()
    await flushPromises()
    ;(Array.from(document.body.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim() === 'TOML') as HTMLElement).click()
    await flushPromises()
    const area = document.body.querySelector('textarea')!
    area.value = 'network_name = ['
    area.dispatchEvent(new Event('input'))
    await flushPromises()
    button('保存')!.click()
    await flushPromises()

    expect(w.emitted('action')).toBeUndefined()
    expect(document.body.textContent).toContain('无法解析：bad')
  })
})
