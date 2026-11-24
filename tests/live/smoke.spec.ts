import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test'

import { LIVE_API } from './env'

const CORE2 = '22222222-2222-4222-8222-222222222222'
const CORE1 = '11111111-1111-4111-8111-111111111111'
const FIXED_IP = '10.144.144.20'

interface Member { device_id: string; virtual_ipv4: string | null }

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

// Independent safety net: own API context + explicit login, so it works even after a page crash or
// test timeout. Cleanup errors are logged and never replace the test's own failure.
// Only resets core2: the test asserts core2 starts on automatic IP and is the only member it changes.
test.afterEach(async ({}, testInfo) => {
  const api = await pwRequest.newContext({ baseURL: LIVE_API })
  try {
    const login = await api.post('/api/v1/auth/login', {
      data: { username: 'admin', password: '21232f297a57a5a743894a0e4a801fc3' }, // MD5('admin'), like the app
    })
    if (!login.ok()) throw new Error(`cleanup login failed: ${login.status()}`)
    const net = await networkId(api)
    if ((await core2Member(api, net)).virtual_ipv4) {
      const res = await api.patch(`/api/v1/networks/${net}/members/${CORE2}`, { data: { virtual_ipv4: '' } })
      if (!res.ok()) throw new Error(`cleanup PATCH failed: ${res.status()}`)
    }
    const after = await core2Member(api, net)
    if (after.virtual_ipv4 !== null) throw new Error(`core2 virtual_ipv4 still ${after.virtual_ipv4}`)
  } catch (e) {
    console.error('[live cleanup] failed:', e)
    if (testInfo.status === 'passed') throw e
  } finally {
    await api.dispose()
  }
})
