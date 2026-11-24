import { expect, test } from '@playwright/test'
import { fleetMock } from './fleet'
import { mockApi } from './mockApi'
import { strToUuid } from '../../src/lib/uuid'

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

test('attention list shows the five fleet items in order', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  const list = page.getByTestId('attention-list')
  await expect(list.getByRole('heading', { name: '需要关注 · 5' })).toBeVisible()
  const rows = list.getByTestId('attention-row')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('unknown-pc 被拉黑后仍在尝试连接')
  await expect(rows.nth(0)).toContainText('已拉黑 · 共尝试 5 次 · 最后 10 分钟前')
  await expect(rows.nth(1)).toContainText('sh-pi 还没加入网络')
  await expect(rows.nth(1).getByRole('button', { name: '加入 家庭网' })).toBeVisible()
  await expect(rows.nth(2)).toContainText('fra-backup 已离线 2 天')
  await expect(rows.nth(3)).toContainText('old-laptop 已离线 3 周')
  await expect(rows.nth(4)).toContainText('3 台设备可更新')
  await expect(rows.nth(4)).toContainText('fra-backup、office-pc 2.6.4')
  await expect(rows.nth(4)).toContainText('old-laptop 2.5.0')
  await expect(rows.nth(4).textContent()).resolves.toMatch(/2\.6\.4.*2\.5\.0/)
})

test('attention actions unblock and join', async ({ page }) => {
  const { overrides, ids, networkId } = fleetMock()
  const { requests } = await mockApi(page, overrides)
  await page.goto('/#/')
  const rows = page.getByTestId('attention-row')
  await rows.nth(0).getByRole('button', { name: '解除拉黑' }).click()
  await expect.poll(() => requests.some((r) => r.method === 'DELETE' && r.path === '/blocked-devices/99999999-0000-4000-8000-000000000001')).toBe(true)
  await rows.nth(1).getByRole('button', { name: '加入 家庭网' }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'POST' && r.path === `/networks/${networkId}/members`)?.body)
    .toEqual({ device_ids: [ids['sh-pi']], temporary: false })
})

test('attention list expands beyond five rows and collapses again', async ({ page }) => {
  const { overrides } = fleetMock()
  const base = overrides['GET /machines']!
  overrides['GET /machines'] = async (req) => {
    const { machines } = (await base(req)) as { machines: Record<string, any>[] }
    const extra = [1, 2].map((n) => ({
      ...machines[0]!,
      client_url: `tcp://9.9.9.${n}:1`,
      info: { ...machines[0]!.info, machine_id: strToUuid(`00000000-0000-4000-8000-0000000009${n}0`), hostname: `extra-${n}` },
      networks: machines[0]!.networks,
      online: false,
      location: null,
      last_seen: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(),
    }))
    return { machines: [...machines, ...extra] }
  }
  await mockApi(page, overrides)
  await page.goto('/#/')
  const list = page.getByTestId('attention-list')
  await expect(list.getByRole('heading', { name: '需要关注 · 7' })).toBeVisible()
  await expect(list.getByTestId('attention-row')).toHaveCount(5)
  await list.getByRole('button', { name: '全部 (7)' }).click()
  await expect(list.getByTestId('attention-row')).toHaveCount(7)
  await list.getByRole('button', { name: '收起' }).click()
  await expect(list.getByTestId('attention-row')).toHaveCount(5)
})

test('connection quality lists the slowest relays first', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  const card = page.getByTestId('connection-quality')
  await expect(card).toContainText('中继 3 · 直连 133')
  const rows = card.getByTestId('quality-row')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('la-vps')
  await expect(rows.nth(0)).toContainText('bj-dev')
  await expect(rows.nth(0)).toContainText('中继 · 经 hk-vps')
  await expect(rows.nth(0)).toContainText('186 ms')
  await expect(rows.nth(1)).toContainText('la-vps')
  await expect(rows.nth(1)).toContainText('sh-dev')
  await expect(rows.nth(1)).toContainText('170 ms')
})

test('webhook mode has no connection quality and no unjoined rows', async ({ page }) => {
  await mockApi(page, {}, { webhook: true })
  await page.goto('/#/')
  await expect(page.getByTestId('attention-list')).toBeVisible()
  await expect(page.getByTestId('connection-quality')).toHaveCount(0)
  await expect(page.getByText('还没加入网络')).toHaveCount(0)
})
