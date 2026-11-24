import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import fixture from '../fixtures/v2.7.1/instance-config-core2.json'
import parseOk from '../fixtures/v2.7.1/parse-config-ok.json'
import { generateToml, parseToml } from '../../src/api/client'
import { ApiError } from '../../src/api/http'
import ConfigEditor from '../../src/components/config-editor/ConfigEditor.vue'
import ConfigEditorDialog from '../../src/components/config-editor/ConfigEditorDialog.vue'
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

  it('enabling the legacy portal fills in defaults; disabling drops only the switch', async () => {
    const w = mountEditor({ modelValue: input(withoutLegacy), coreVersion: '2.6.4' })
    const vpn = section(w, 'vpnPortal')
    await control(vpn, '启用').setValue(true)
    expect(lastDraft(w)).toMatchObject({
      enable_vpn_portal: true,
      vpn_portal_listen_port: 22022,
      vpn_portal_client_network_addr: '10.14.14.0',
      vpn_portal_client_network_len: 24,
    })

    // Off is the switch's default, so the field goes; the port and network stay for next time.
    await control(vpn, '启用').setValue(false)
    const off = lastDraft(w)
    expect('enable_vpn_portal' in off).toBe(false)
    expect(off).toMatchObject({ vpn_portal_listen_port: 22022, vpn_portal_client_network_addr: '10.14.14.0', vpn_portal_client_network_len: 24 })
    expect(control(vpn, '启用').element.checked).toBe(false)
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
    const w = mountEditor({ modelValue: input(withoutLegacy), coreVersion: '2.7.1' })
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

    await control(vpn, '启用').setValue(false)
    expect(lastDraft(w).vpn_portal_config).toMatchObject({ enabled: false, wireguard_listen: '0.0.0.0:22022' })
    expect(lastDraft(w).vpn_portal_config!.clients).toHaveLength(1)
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
