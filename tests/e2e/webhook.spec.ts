import { expect, test } from '@playwright/test'
import { fixture, mockApi, type RecordedRequest } from './mockApi'

const CORE1 = '11111111-1111-4111-8111-111111111111'

const networkCalls = (reqs: RecordedRequest[]) => reqs.filter((r) => r.path.startsWith('/networks'))
const rpcCalls = (reqs: RecordedRequest[]) => reqs.filter((r) => r.path.includes('/proxy-rpc'))

test('webhook mode: device list loads without join buttons or 未加入网络', async ({ page }) => {
  const { requests } = await mockApi(page, {}, { webhook: true })
  await page.goto('/#/devices')
  await expect(page.getByTestId('device-name')).toHaveText(['core1', 'core2', 'core3'])
  await expect(page.getByText('3 台设备 · 3 台在线', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ip-none')).toHaveCount(3)
  await expect(page.getByTestId('ip-none').first()).toHaveText('—')
  await expect(page.getByText('未加入网络')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^加入 / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^离线/ })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Alias and delete need the central device registry; only copying the ID remains.
  await page.getByRole('row').filter({ hasText: 'core1' }).getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['复制设备 ID'])
  await page.keyboard.press('Escape')

  // The bell's endpoint exists in webhook mode, so it stays.
  await expect(page.getByRole('button', { name: '被拉黑的设备' })).toBeVisible()
  expect(networkCalls(requests)).toEqual([])
})

test('webhook mode: device detail shows the overview only', async ({ page }) => {
  await page.clock.install()
  const { requests } = await mockApi(page, {}, { webhook: true })
  await page.goto(`/#/devices/${CORE1}`)
  const ov = page.getByTestId('overview-card')
  await expect(ov).toContainText(CORE1)
  await expect(ov).toContainText('2.6.4-8428a89d')
  await expect(ov).not.toContainText('未加入网络')
  await expect(page.getByRole('heading', { name: 'core1' })).toBeVisible()
  for (const id of ['connections-card', 'settings-card', 'diagnostics-card', 'danger-zone']) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
  await expect(page.getByText('还没加入网络')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /切换网络/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /修改别名/ })).toHaveCount(0)
  await page.getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['复制设备 ID'])
  await page.keyboard.press('Escape')

  const polls = () => requests.filter((r) => r.method === 'GET' && r.path === '/machines').length
  const before = polls()
  await page.clock.runFor(20_000)
  await expect.poll(polls).toBeGreaterThan(before)
  expect(rpcCalls(requests)).toEqual([])
  expect(networkCalls(requests)).toEqual([])
})

test('webhook mode: a session without a heartbeat yet is listed under its client_url', async ({ page }) => {
  const pendingUrl = 'tcp://203.0.113.9:11010'
  await mockApi(
    page,
    {
      'GET /machines': () => {
        const base = fixture('machines.json')
        for (const m of base.machines) { m.networks = []; m.alias = null }
        base.machines.push({ client_url: pendingUrl, info: null, location: null, alias: null, networks: [], online: false, last_seen: null })
        return base
      },
    },
    { webhook: true },
  )
  await page.goto('/#/devices')
  await expect(page.getByTestId('device-name')).toHaveCount(4)
  const row = page.getByRole('row').filter({ hasText: pendingUrl })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('button', { name: '更多操作' })).toHaveCount(0)
  await expect(row.getByTestId('ip-none')).toHaveText('—')

  // Its detail page (id = client_url) shows the header and overview, with nothing to act on.
  await row.getByTestId('device-name').click()
  await expect(page.getByRole('heading', { name: pendingUrl })).toBeVisible()
  await expect(page.getByTestId('overview-card')).toContainText('203.0.113.9')
  await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(0)
  await expect(page.getByText('找不到这台设备')).toHaveCount(0)
})

test('webhook mode at 390px: cards show — instead of a join button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await mockApi(page, {}, { webhook: true })
  await page.goto('/#/devices')
  await expect(page.getByTestId('device-card')).toHaveCount(3)
  await expect(page.getByTestId('ip-none')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /^加入 / })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
