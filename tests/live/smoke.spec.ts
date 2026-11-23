import { expect, test, type APIRequestContext } from '@playwright/test'

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

test('live smoke: login, devices, connections, fixed IP round trip', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('et.locale', 'zh-CN') } catch { /* ignore */ }
  })
  let net: string | null = null
  try {
    // 1. login
    await page.goto('/#/login')
    await page.getByLabel('用户名').fill('admin')
    await page.getByLabel('密码').fill('admin')
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page).toHaveURL(/#\/devices$/)

    // 2. device list
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
    await page.screenshot({ path: '.superpowers/sdd/2026-11-23-02-frontend-foundation-and-devices/task-11-live-detail.png', fullPage: true })

    // 4. core2: set fixed IP, verify via API
    net = await networkId(page.request)
    expect((await core2Member(page.request, net)).virtual_ipv4).toBeNull()
    await page.goto(`/#/devices/${CORE2}`)
    const settings = page.getByTestId('settings-card')
    await settings.getByTestId('setting-ip').getByRole('button', { name: '设为固定' }).click()
    await settings.getByPlaceholder('10.144.144.9').fill(FIXED_IP)
    await settings.getByRole('button', { name: '保存' }).first().click()
    await expect.poll(async () => (await core2Member(page.request, net!)).virtual_ipv4).toBe(FIXED_IP)
    await expect(settings.getByTestId('setting-ip')).toContainText(`固定 · ${FIXED_IP}`)

    // restore via the UI
    await settings.getByTestId('setting-ip').getByRole('button', { name: '改回自动' }).click()
    await expect.poll(async () => (await core2Member(page.request, net!)).virtual_ipv4).toBeNull()
  } finally {
    // Always leave core2 on automatic IP, even when an assertion above failed.
    if (net) {
      const m = await core2Member(page.request, net)
      if (m.virtual_ipv4) {
        await page.request.patch(`/api/v1/networks/${net}/members/${CORE2}`, { data: { virtual_ipv4: '' } })
      }
      await expect.poll(async () => (await core2Member(page.request, net!)).virtual_ipv4).toBeNull()
    }
  }
})
