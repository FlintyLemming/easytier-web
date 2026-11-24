import { expect, test } from '@playwright/test'
import { fleetMock } from './fleet'
import { mockApi } from './mockApi'

test('overview heading, nav state and logo navigation', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { level: 1, name: '概览' })).toBeVisible()
  await expect(page.getByText('每 10 秒自动刷新')).toBeVisible()
  const nav = page.getByRole('navigation', { name: '主导航' })
  await expect(nav.getByRole('link', { name: '概览' })).toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: '设备' }).click()
  await expect(page).toHaveURL(/#\/devices$/)
  await expect(nav.getByRole('link', { name: '概览' })).not.toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: /EasyTier/ }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { level: 1, name: '概览' })).toBeVisible()
})

test('stat cards show the fleet totals', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  const online = page.getByTestId('stat-online')
  await expect(online.getByText('18', { exact: true })).toBeVisible()
  await expect(online.getByText('/ 20')).toBeVisible()
  await expect(online.getByText('2 台离线')).toBeVisible()
  const networks = page.getByTestId('stat-networks')
  await expect(networks.getByText('1', { exact: true })).toBeVisible()
  await expect(networks).toContainText('家庭网 · 10.144.0.0/24')
  const direct = page.getByTestId('stat-direct')
  await expect(direct.getByText('98%')).toBeVisible()
  await expect(direct.getByText('136 条连接中 3 条走中继')).toBeVisible()
  const outdated = page.getByTestId('stat-outdated')
  await expect(outdated.getByText('3', { exact: true })).toBeVisible()
  await expect(outdated).toContainText('最新版本 2.7.1')
})

test('direct rate reads 正在读取连接… until proxy-rpc answers', async ({ page }) => {
  const { overrides } = fleetMock()
  const rpc = overrides['POST /machines/*/proxy-rpc']!
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  overrides['POST /machines/*/proxy-rpc'] = async (req) => {
    await gate
    return rpc(req)
  }
  await mockApi(page, overrides)
  await page.goto('/#/')
  const direct = page.getByTestId('stat-direct')
  await expect(direct.getByText('正在读取连接…')).toBeVisible()
  await expect(direct.getByText('—', { exact: true })).toBeVisible()
  release()
  await expect(direct.getByText('98%')).toBeVisible()
})

test('webhook mode shows two cells and makes no proxy-rpc requests', async ({ page }) => {
  const { requests } = await mockApi(page, {}, { webhook: true })
  await page.goto('/#/')
  await expect(page.getByTestId('stat-online')).toBeVisible()
  await expect(page.getByTestId('stat-outdated')).toBeVisible()
  await expect(page.getByTestId('stat-networks')).toHaveCount(0)
  await expect(page.getByTestId('stat-direct')).toHaveCount(0)
  await page.waitForTimeout(2000)
  expect(requests.filter((r) => r.path.endsWith('/proxy-rpc'))).toHaveLength(0)
})
