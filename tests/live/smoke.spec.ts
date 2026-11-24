import { readFileSync } from 'node:fs'
import { expect, request as pwRequest, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

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

    // 1. MTU 1300 through the form.
    let dlg = await openEditor()
    await dlg.getByLabel('MTU', { exact: true }).fill('1300')
    await dlg.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(async () => (await memberConfig(page.request, net)).mtu).toBe(1300)
    const saved = await memberConfig(page.request, net)
    expect(saved).not.toHaveProperty('network_name')
    await expect(state).toHaveText('已覆盖')

    // 2. Through the TOML tab: the real generate-config, an edit, the real parse-config on the way back.
    dlg = await openEditor()
    await dlg.getByRole('tab', { name: 'TOML' }).click()
    const toml = dlg.getByRole('textbox', { name: 'TOML' })
    await expect(toml).toHaveValue(/mtu = 1300/)
    const generated = await toml.inputValue()
    await toml.fill(`${generated.endsWith('\n') ? generated : `${generated}\n`}# live-smoke\n`)
    const parsed = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/parse-config'))
    await dlg.getByRole('tab', { name: '表单' }).click()
    const parseBody = (await (await parsed).json()) as { error?: string | null }
    expect(parseBody.error ?? null, 'parse-config accepts the edited TOML').toBeNull()
    await expect(dlg.getByLabel('MTU', { exact: true })).toHaveValue('1300')
    await dlg.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    const roundTrip = await memberConfig(page.request, net)
    for (const field of CENTRAL_OWNED_FIELDS) expect(roundTrip, `central-owned ${field}`).not.toHaveProperty(field)
    expect(roundTrip.mtu).toBe(1300)
    expect(overrideState(roundTrip)).toBe('overridden')
    const added = Object.fromEntries(Object.entries(roundTrip).filter(([k]) => !(k in saved)))
    console.log(`[live member override] form save ${JSON.stringify(saved)}; the TOML round trip added ${JSON.stringify(added)}`)
    await expect(state).toHaveText('已覆盖')

    // 3. 恢复默认, confirmed.
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
