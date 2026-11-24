import { readFileSync } from 'node:fs'
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test'

import { CENTRAL_OWNED_FIELDS, overrideState } from '../../src/domain/memberOverride'
import { uuidToStr, type UUID } from '../../src/lib/uuid'
import { LIVE_API } from './env'

const CORE2 = '22222222-2222-4222-8222-222222222222'
const CORE1 = '11111111-1111-4111-8111-111111111111'
const FIXED_IP = '10.144.144.20'
/** The manual instance the instances smoke creates on core2 (and its cleanup removes). */
const MANUAL = 'live-manual'

interface Member { device_id: string; virtual_ipv4: string | null; has_override?: boolean }

async function networkId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/v1/networks')
  expect(res.ok()).toBeTruthy()
  const nets = (await res.json()).networks as { network_id: string; network_name: string }[]
  const home = nets.find((n) => n.network_name === 'home-central')
  expect(home, 'network home-central exists').toBeTruthy()
  return home!.network_id
}

async function core2Member(request: APIRequestContext, net: string): Promise<Member> {
  const res = await request.get(`/api/v1/networks/${net}/members`)
  expect(res.ok()).toBeTruthy()
  const m = ((await res.json()).members as Member[]).find((x) => x.device_id === CORE2)
  expect(m, 'core2 member exists').toBeTruthy()
  return m!
}

async function memberConfig(request: APIRequestContext, net: string): Promise<Record<string, unknown>> {
  const res = await request.get(`/api/v1/networks/${net}/members/${CORE2}/config`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as Record<string, unknown>
}

/** Ids of core2's instances (running or disabled) whose network is `name`. */
async function instancesNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const res = await request.get(`/api/v1/machines/${CORE2}/networks`)
  if (!res.ok()) throw new Error(`instance list failed: ${res.status()}`)
  const list = (await res.json()) as { running_inst_ids?: UUID[]; disabled_inst_ids?: UUID[] }
  const ids = [...(list.running_inst_ids ?? []), ...(list.disabled_inst_ids ?? [])].map(uuidToStr)
  if (ids.length === 0) return []
  const metasRes = await request.post(`/api/v1/machines/${CORE2}/networks/metas`, { data: { instance_ids: ids } })
  if (!metasRes.ok()) throw new Error(`instance metas failed: ${metasRes.status()}`)
  const metas = ((await metasRes.json()) as { metas?: Record<string, { network_name?: string }> }).metas ?? {}
  const named: string[] = []
  for (const id of new Set(ids)) {
    let network = metas[id]?.network_name
    // No meta: read the stored config, so an instance the metas leave out is still found.
    if (network === undefined) {
      const cfg = await request.get(`/api/v1/machines/${CORE2}/networks/config/${id}`)
      if (cfg.ok()) network = ((await cfg.json()) as { network_name?: string }).network_name
    }
    if (network === name) named.push(id)
  }
  return named
}

async function loginUi(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('et.locale', 'zh-CN') } catch { /* ignore */ }
  })
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/#\/$/)
}

/**
 * Independent safety net: own API context + explicit login, so it works even after a page crash or
 * test timeout. Cleanup errors are logged and never replace the test's own failure.
 */
async function cleanUp(testInfo: TestInfo, what: string, run: (api: APIRequestContext) => Promise<void>) {
  const api = await pwRequest.newContext({ baseURL: LIVE_API })
  try {
    const login = await api.post('/api/v1/auth/login', {
      data: { username: 'admin', password: '21232f297a57a5a743894a0e4a801fc3' }, // MD5('admin'), like the app
    })
    if (!login.ok()) throw new Error(`cleanup login failed: ${login.status()}`)
    await run(api)
  } catch (e) {
    console.error(`[live cleanup] ${what} failed:`, e)
    if (testInfo.status === 'passed') throw e
  } finally {
    await api.dispose()
  }
}

test('live smoke: login, devices, connections, fixed IP round trip', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('et.locale', 'zh-CN') } catch { /* ignore */ }
  })
  // 1. login
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/#\/$/)

  // 2. device list
  await page.getByRole('navigation').getByRole('link', { name: '设备' }).click()
  await expect(page).toHaveURL(/#\/devices$/)
  for (const name of ['core1', 'core2', 'core3']) {
    const row = page.getByRole('row').filter({ has: page.getByTestId('device-name').getByText(name, { exact: true }) })
    await expect(row).toHaveCount(1)
    await expect(row.getByText(/^10\.144\.144\.\d+$/)).toBeVisible()
  }

  // 3. core1 detail: connections to core2 and core3
  await page.getByTestId('device-name').getByText('core1', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/devices/${CORE1}`))
  const conns = page.getByTestId('connections-card')
  await expect(conns.getByText('core2', { exact: true })).toBeVisible()
  await expect(conns.getByText('core3', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('live-detail.png'), fullPage: true })

  // 4. core2: set fixed IP, verify via API
  const net = await networkId(page.request)
  expect((await core2Member(page.request, net)).virtual_ipv4).toBeNull()
  await page.goto(`/#/devices/${CORE2}`)
  const settings = page.getByTestId('settings-card')
  await settings.getByTestId('setting-ip').getByRole('button', { name: '设为固定' }).click()
  await settings.getByPlaceholder('10.144.144.9').fill(FIXED_IP)
  await settings.getByTestId('setting-ip').getByRole('button', { name: '保存' }).click()
  await expect.poll(async () => (await core2Member(page.request, net)).virtual_ipv4).toBe(FIXED_IP)
  await expect(settings.getByTestId('setting-ip')).toContainText(`固定 · ${FIXED_IP}`)

  // restore via the UI
  await settings.getByTestId('setting-ip').getByRole('button', { name: '改回自动' }).click()
  await expect.poll(async () => (await core2Member(page.request, net)).virtual_ipv4).toBeNull()
})

test('overview against the real backend', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('et.locale', 'zh-CN') } catch { /* ignore */ }
  })
  const origins = new Set<string>()
  page.on('request', (req) => {
    const u = new URL(req.url())
    if (u.protocol === 'http:' || u.protocol === 'https:') origins.add(u.origin)
  })
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/#\/$/)

  const online = page.getByTestId('stat-online')
  await expect(online.getByText('3', { exact: true })).toBeVisible()
  await expect(online.getByText('/ 3')).toBeVisible()
  // proxy-rpc answers can take a while; the card shows 「—」 until then
  const direct = page.getByTestId('stat-direct')
  await expect(direct.getByText(/^\d+%$/)).toBeVisible({ timeout: 40_000 })
  console.log('[live overview] direct rate:', await direct.getByText(/^\d+%$/).textContent())

  const ranking = page.getByTestId('location-ranking')
  await expect(ranking).toContainText('本地网络')
  await expect(ranking).toContainText('3/3')
  await expect(page.getByTestId('map-section').getByText('还没有可以定位的设备')).toBeVisible()

  const allowed = new Set([new URL(page.url()).origin, new URL(LIVE_API).origin])
  const stray = [...origins].filter((o) => !allowed.has(o))
  expect(stray, 'requests outside the app origin and the API').toEqual([])
})

// Only resets core2's IP: the fixed IP test asserts core2 starts on automatic IP and is the only member it changes.
test.afterEach(async ({}, testInfo) => {
  await cleanUp(testInfo, 'core2 virtual_ipv4', async (api) => {
    const net = await networkId(api)
    if ((await core2Member(api, net)).virtual_ipv4) {
      const res = await api.patch(`/api/v1/networks/${net}/members/${CORE2}`, { data: { virtual_ipv4: '' } })
      if (!res.ok()) throw new Error(`cleanup PATCH failed: ${res.status()}`)
    }
    const after = await core2Member(api, net)
    if (after.virtual_ipv4 !== null) throw new Error(`core2 virtual_ipv4 still ${after.virtual_ipv4}`)
  })
})

test.describe('member advanced config', () => {
  // core2 starts without a member override (the test asserts it), so clearing it restores the testenv.
  test.afterEach(async ({}, testInfo) => {
    await cleanUp(testInfo, 'core2 member config', async (api) => {
      const net = await networkId(api)
      const res = await api.delete(`/api/v1/networks/${net}/members/${CORE2}/config`)
      if (!res.ok()) throw new Error(`cleanup DELETE failed: ${res.status()}`)
      if ((await core2Member(api, net)).has_override) {
        throw new Error('core2 still has a member override')
      }
    })
  })

  test('live smoke: MTU override, TOML round trip and 恢复默认 on core2', async ({ page }) => {
    await loginUi(page)
    const net = await networkId(page.request)
    expect(await memberConfig(page.request, net), 'core2 starts without a member override').toEqual({})

    await page.goto(`/#/devices/${CORE2}`)
    const row = page.getByTestId('settings-card').getByTestId('setting-advanced')
    const state = row.getByTestId('advanced-state')
    await expect(state).toHaveText('默认')
    const openEditor = async () => {
      await row.getByRole('button', { name: '编辑', exact: true }).click()
      const dlg = page.getByRole('dialog', { name: '高级配置 · core2' })
      await expect(dlg).toBeVisible()
      return dlg
    }
    // R17: the TOML tab (the real generate-config), a comment line appended, back to 表单 (the real
    // parse-config, which only runs on an edited TOML).
    const tomlRoundTrip = async (dlg: Locator, expected: RegExp) => {
      const generatedRes = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/generate-config'))
      await dlg.getByRole('tab', { name: 'TOML' }).click()
      const generateBody = (await (await generatedRes).json()) as { error?: string | null }
      expect(generateBody.error ?? null, 'generate-config accepts the draft').toBeNull()
      const toml = dlg.getByRole('textbox', { name: 'TOML' })
      await expect(toml).toHaveValue(expected)
      const generated = await toml.inputValue()
      await toml.fill(`${generated.endsWith('\n') ? generated : `${generated}\n`}# live-smoke\n`)
      const parsed = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/parse-config'))
      await dlg.getByRole('tab', { name: '表单' }).click()
      const parseBody = (await (await parsed).json()) as { error?: string | null }
      expect(parseBody.error ?? null, 'parse-config accepts the edited TOML').toBeNull()
      await expect(dlg.getByRole('tab', { name: '表单' })).toHaveAttribute('aria-selected', 'true')
    }
    const save = async (dlg: Locator) => {
      await dlg.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dlg).toHaveCount(0)
    }

    // 1. A TOML round trip from the 默认 state must leave core2 without an override: anything
    // non-central and non-default that parse-config adds would be written and flip the row to 已覆盖.
    // The dialog closes only after its write (if any) has finished, so the reads below see it.
    let dlg = await openEditor()
    await tomlRoundTrip(dlg, /\S/)
    await save(dlg)
    expect(await memberConfig(page.request, net), 'TOML round trip from 默认 writes no override').toEqual({})
    expect((await core2Member(page.request, net)).has_override ?? false, 'core2 still has no override object').toBe(false)
    await expect(state).toHaveText('默认')

    // 2. MTU 1300 through the form.
    dlg = await openEditor()
    await dlg.getByLabel('MTU', { exact: true }).fill('1300')
    await save(dlg)
    await expect.poll(async () => (await memberConfig(page.request, net)).mtu).toBe(1300)
    const saved = await memberConfig(page.request, net)
    expect(saved).not.toHaveProperty('network_name')
    await expect(state).toHaveText('已覆盖')

    // 3. A TOML round trip from the overridden state must store the same override: the state alone
    // cannot tell (mtu 1300 already makes it 已覆盖), so compare with what the form save stored.
    dlg = await openEditor()
    await tomlRoundTrip(dlg, /mtu = 1300/)
    await expect(dlg.getByLabel('MTU', { exact: true })).toHaveValue('1300')
    await save(dlg)
    const roundTrip = await memberConfig(page.request, net)
    for (const field of CENTRAL_OWNED_FIELDS) expect(roundTrip, `central-owned ${field}`).not.toHaveProperty(field)
    expect(roundTrip.mtu).toBe(1300)
    expect(overrideState(roundTrip)).toBe('overridden')
    const added = Object.fromEntries(Object.entries(roundTrip).filter(([k]) => !(k in saved)))
    console.log(`[live member override] form save ${JSON.stringify(saved)}; the TOML round trip added ${JSON.stringify(added)}`)
    expect(overrideState(added), 'TOML round trip added non-default fields').toBe('default')
    // Stricter: even a default-valued field in the override would pin it against the central config.
    expect(added, 'TOML round trip added fields to the override').toEqual({})
    expect(roundTrip, 'TOML round trip stores the override the form saved').toEqual(saved)
    await expect(state).toHaveText('已覆盖')

    // 4. 恢复默认, confirmed.
    await row.getByRole('button', { name: '恢复默认' }).click()
    const confirm = page.getByRole('dialog', { name: '恢复默认配置' })
    await confirm.getByRole('button', { name: '恢复默认' }).click()
    await expect(state).toHaveText('默认')
    // core2 has no subnet proxies, so 恢复默认 DELETEs the override.
    expect(await memberConfig(page.request, net)).toEqual({})
  })
})

test.describe('manual instances', () => {
  test.afterEach(async ({}, testInfo) => {
    await cleanUp(testInfo, `${MANUAL} instances`, async (api) => {
      for (const id of await instancesNamed(api, MANUAL)) {
        const res = await api.delete(`/api/v1/machines/${CORE2}/networks/${id}`)
        if (!res.ok()) throw new Error(`cleanup DELETE ${id} failed: ${res.status()}`)
      }
      const left = await instancesNamed(api, MANUAL)
      if (left.length > 0) throw new Error(`${MANUAL} instances left: ${left.join(', ')}`)
    })
  })

  test('live smoke: create, export and delete a manual instance on core2', async ({ page }) => {
    await loginUi(page)
    expect(await instancesNamed(page.request, MANUAL), `no ${MANUAL} instance before the test`).toEqual([])

    await page.goto(`/#/devices/${CORE2}`)
    await page.getByRole('button', { name: /切换网络/ }).click()
    await page.getByRole('menuitem', { name: '手动实例（高级）…' }).click()
    await expect(page).toHaveURL(new RegExp(`#/devices/${CORE2}/instances$`))

    // 仅保存 stores the config without starting it: the instance is disabled.
    await page.getByRole('button', { name: '新建实例' }).click()
    const dlg = page.getByRole('dialog', { name: '新建实例' })
    await dlg.getByLabel('网络名', { exact: true }).fill(MANUAL)
    await dlg.getByRole('button', { name: '仅保存' }).click()
    await expect(dlg).toHaveCount(0)
    const row = page.getByTestId('instance-row').filter({ hasText: MANUAL })
    await expect(row).toHaveCount(1)
    // web v2.7.1 can race the save with its runtime reconcile: it then runs the new instance until a
    // later heartbeat cleans it up (seen: 5–25 s), and lists it as running until then.
    await expect(row).toContainText('已停用', { timeout: 60_000 })
    const menu = row.getByRole('button', { name: `${MANUAL} 的操作` })

    // 导出 TOML goes through the real generate-config.
    await menu.click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: '导出 TOML' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`${MANUAL}.toml`)
    expect(readFileSync(await file.path(), 'utf8')).toContain(`network_name = "${MANUAL}"`)

    await menu.click()
    await page.getByRole('menuitem', { name: '删除…', exact: true }).click()
    await page.getByRole('dialog', { name: '删除实例' }).getByRole('button', { name: '删除', exact: true }).click()
    await expect(page.getByText(`已删除 ${MANUAL}`)).toBeVisible()
    await expect(row).toHaveCount(0)
    expect(await instancesNamed(page.request, MANUAL)).toEqual([])
  })
})

test.describe('networks page', () => {
  const LIVE_NET = 'live-net'
  const CORE3 = '33333333-3333-4333-8333-333333333333'

  async function liveNetIds(api: APIRequestContext): Promise<string[]> {
    const res = await api.get('/api/v1/networks')
    if (!res.ok()) throw new Error(`network list failed: ${res.status()}`)
    const nets = (await res.json()).networks as { network_id: string; display_name: string }[]
    return nets.filter((n) => n.display_name === LIVE_NET).map((n) => n.network_id)
  }

  async function core3Runs(api: APIRequestContext, id: string): Promise<boolean> {
    const res = await api.get(`/api/v1/machines/${CORE3}/networks`)
    const list = (await res.json()) as { running_inst_ids?: UUID[] }
    return (list.running_inst_ids ?? []).map(uuidToStr).includes(id)
  }

  test.afterEach(async ({}, testInfo) => {
    await cleanUp(testInfo, `${LIVE_NET} networks`, async (api) => {
      for (const id of await liveNetIds(api)) {
        const res = await api.delete(`/api/v1/networks/${id}`)
        if (!res.ok()) throw new Error(`cleanup DELETE ${id} failed: ${res.status()}`)
      }
      const left = await liveNetIds(api)
      if (left.length > 0) throw new Error(`${LIVE_NET} networks left: ${left.join(', ')}`)
    })
  })

  test('live smoke: create a secure network, temporary member, acl, credential, settings, delete', async ({ page }) => {
    test.setTimeout(300_000)
    await loginUi(page)
    expect(await liveNetIds(page.request), `no ${LIVE_NET} network before the test`).toEqual([])

    // 1. one network: /networks opens it
    await page.goto('/#/networks')
    const home = await networkId(page.request)
    await expect(page).toHaveURL(new RegExp(`#/networks/${home}$`))
    for (const name of ['core1', 'core2', 'lab-box']) await expect(page.getByTestId('member-row').filter({ hasText: name })).toHaveCount(1)

    // 2. back to the list and create a secure standalone network
    await page.getByRole('link', { name: '网络', exact: true }).last().click()
    await page.getByRole('button', { name: '新建网络' }).click()
    const create = page.getByRole('dialog', { name: '新建网络' })
    await create.getByLabel('显示名').fill(LIVE_NET)
    await create.getByRole('radio', { name: '独立' }).check()
    await create.getByLabel('网段').fill('10.202.0.0/24')
    await create.getByRole('checkbox', { name: '安全模式' }).check()
    await create.getByRole('button', { name: '创建' }).click()
    await expect(page.getByRole('heading', { level: 1, name: LIVE_NET })).toBeVisible()
    const [net] = await liveNetIds(page.request)
    expect(net).toBeTruthy()
    await expect(page).toHaveURL(new RegExp(`#/networks/${net}$`))

    // 3. core3 joins as a temporary member and runs
    await page.getByRole('button', { name: '添加成员' }).click()
    const add = page.getByRole('dialog', { name: '添加成员' })
    await add.getByRole('checkbox', { name: /core3/ }).check()
    await add.getByRole('checkbox', { name: '作为临时成员加入' }).check()
    await add.getByLabel('有效期').selectOption({ label: '24 小时' })
    await add.getByRole('button', { name: '添加 1 台设备' }).click()
    const core3 = page.getByTestId('member-row').filter({ hasText: 'core3' })
    await expect(core3.getByText('临时', { exact: true })).toBeVisible()
    await expect(core3).toContainText('运行中', { timeout: 60_000 })

    // 4. an ACL rule round trip
    await page.getByRole('tab', { name: 'ACL' }).click()
    await page.getByRole('button', { name: '添加规则' }).click()
    const rule = page.getByRole('dialog', { name: '添加规则' })
    await rule.getByLabel('名称').fill('live-rule')
    await rule.getByRole('group', { name: '来源' }).getByRole('checkbox', { name: '全部成员' }).check()
    await rule.getByRole('group', { name: '目标' }).getByRole('checkbox', { name: /^core3/ }).check()
    await rule.getByLabel('端口 1').fill('22')
    await rule.getByRole('button', { name: '完成' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('已保存 ACL')).toBeVisible()
    const acl = await (await page.request.get(`/api/v1/networks/${net}/acl-policy`)).json()
    const saved = acl.policy.rules.find((r: { name: string }) => r.name === 'live-rule')
    expect(saved.protocols).toEqual([{ protocol: 'tcp', ports: ['22'], stateful: true }])

    // 5. a credential: join info, then revoke
    await page.getByRole('tab', { name: '凭据' }).click()
    await page.getByRole('button', { name: '生成凭据' }).click()
    const gen = page.getByRole('dialog', { name: '生成凭据' })
    await gen.getByLabel('有效期').selectOption({ label: '1 小时' })
    await gen.getByRole('button', { name: '生成', exact: true }).click()
    const join = page.getByRole('dialog', { name: /^接入信息 · credential-/ })
    const networkName = (await (await page.request.get(`/api/v1/networks/${net}`)).json()).network_name as string
    await expect(join.getByRole('textbox')).toHaveValue(new RegExp(`--network-name ${networkName} --secure-mode --credential `))
    const credId = ((await join.getByRole('heading').textContent()) ?? '').replace('接入信息 · ', '').trim()
    await page.keyboard.press('Escape')
    const credRow = page.getByTestId('credential-row').filter({ hasText: credId })
    await credRow.getByRole('button', { name: `${credId} 的操作` }).click()
    await page.getByRole('menuitem', { name: '吊销…' }).click()
    await page.getByRole('dialog', { name: '吊销凭据' }).getByRole('button', { name: '吊销' }).click()
    await expect(credRow).toHaveCount(0)

    // 6. settings: a new subnet, confirmed
    await page.getByRole('tab', { name: '设置' }).click()
    await page.getByLabel('网段').fill('10.203.0.0/24')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('dialog', { name: '保存网络设置' }).getByRole('button', { name: '确认' }).click()
    await expect(page.getByText('已保存网络设置')).toBeVisible()
    expect((await (await page.request.get(`/api/v1/networks/${net}`)).json()).virtual_cidr).toBe('10.203.0.0/24')

    // 7. delete: back to the list, and core3 drops the instance
    await page.getByRole('button', { name: '删除网络…' }).click()
    await page.getByRole('dialog', { name: '删除网络' }).getByRole('button', { name: '删除', exact: true }).click()
    await expect(page).toHaveURL(/#\/networks\?list=1$/)
    expect(await liveNetIds(page.request)).toEqual([])
    await expect.poll(() => core3Runs(page.request, net!), { timeout: 90_000, intervals: [3000] }).toBe(false)
    expect(await core3Runs(page.request, home)).toBe(true)
  })
})
