import { expect, test, type Page } from '@playwright/test'
import { fixture, mockApi, type Overrides } from './mockApi'

const CORE1 = '11111111-1111-4111-8111-111111111111'
const NEW_ID = '44444444-4444-4444-8444-444444444444'
const PRIMARY = fixture('networks.json').networks[0].network_id as string

function machines(extra: object[] = [], patch?: (m: any) => void) {
  const base = fixture('machines.json')
  if (patch) base.machines.forEach(patch)
  base.machines.push(...extra)
  return base
}

function newMachine(o: { version?: string; hostname?: string } = {}) {
  return {
    client_url: 'udp://8.8.4.4:1111',
    info: {
      machine_id: { part1: 0x44444444, part2: 0x44444444, part3: 0x84444444, part4: 0x44444444 },
      easytier_version: o.version ?? '2.7.1',
      hostname: o.hostname ?? 'newbox',
      device_os: { os_type: 'linux', version: '1', distribution: 'Debian' },
    },
    location: null,
    networks: [],
    online: true,
    last_seen: new Date().toISOString(),
  }
}

async function open(page: Page, overrides: Overrides = {}) {
  const ctx = await mockApi(page, overrides)
  await page.goto('/#/devices')
  return ctx
}

test('header copy and column order', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('heading', { name: '设备', exact: true })).toBeVisible()
  await expect(page.getByText('3 台设备 · 3 台在线 · 0 台待加入网络')).toBeVisible()
  await expect(page.getByRole('columnheader')).toHaveText(['设备', '内网 IP', '位置 · 公网 IP', '版本', '最后在线', ''])
  await expect(page.getByRole('button', { name: /^添加设备$/ })).toHaveCount(1) // nav only, none in the page body
})

test('core1 row shows ip with network name and navigates on click', async ({ page }) => {
  await open(page)
  const row = page.getByRole('row').filter({ hasText: 'core1' })
  await expect(row).toContainText('10.144.144.1')
  await expect(row).toContainText('home-central')
  await expect(row).toContainText('在线')
  await row.getByText('Alpine Linux').click()
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE1}$`))
})

test('row is keyboard reachable', async ({ page }) => {
  await open(page)
  const row = page.getByRole('row').filter({ hasText: 'core1' })
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE1}$`))
})

test('unjoined device offers 加入 home-central and posts members', async ({ page }) => {
  const { requests } = await open(page, { 'GET /machines': () => machines([newMachine()]) })
  const row = page.getByRole('row').filter({ hasText: 'newbox' })
  await expect(row.getByText('未加入网络')).toBeVisible()
  await row.getByRole('button', { name: '加入 home-central' }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'POST' && r.path === `/networks/${PRIMARY}/members`)?.body)
    .toMatchObject({ device_ids: [NEW_ID] })
  await expect(page).toHaveURL(/#\/devices$/)
})

test('outdated pill appears for old devices when a newer one exists', async ({ page }) => {
  await open(page, { 'GET /machines': () => machines([newMachine({ version: '2.7.1' })]) })
  for (const n of ['core1', 'core2', 'core3']) {
    await expect(page.getByRole('row').filter({ hasText: n })).toContainText('可更新')
  }
  await expect(page.getByRole('row').filter({ hasText: 'newbox' })).not.toContainText('可更新')
})

test('rename via menu sends PUT alias', async ({ page }) => {
  const { requests } = await open(page)
  const row = page.getByRole('row').filter({ hasText: 'core1' })
  await row.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '重命名' }).click()
  const input = page.getByRole('dialog').getByRole('textbox')
  await input.fill('书房')
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'PUT' && r.path === `/machines/${CORE1}/alias`)?.body)
    .toEqual({ alias: '书房' })
})

test('delete with 同时拉黑 sends DELETE ?block=true', async ({ page }) => {
  const reqs: string[] = []
  page.on('request', (r) => { if (r.method() === 'DELETE') reqs.push(r.url()) })
  await open(page)
  const row = page.getByRole('row').filter({ hasText: 'core1' })
  await row.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除设备…' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('checkbox', { name: '同时拉黑' })).toBeChecked()
  await dlg.getByRole('button', { name: '删除' }).click()
  await expect.poll(() => reqs.some((u) => u.endsWith(`/machines/${CORE1}?block=true`))).toBe(true)
})

test('delete without 同时拉黑 omits block', async ({ page }) => {
  const reqs: string[] = []
  page.on('request', (r) => { if (r.method() === 'DELETE') reqs.push(r.url()) })
  await open(page)
  await page.getByRole('row').filter({ hasText: 'core1' }).getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除设备…' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('checkbox', { name: '同时拉黑' }).uncheck()
  await dlg.getByRole('button', { name: '删除' }).click()
  await expect.poll(() => reqs.some((u) => u.endsWith(`/machines/${CORE1}`))).toBe(true)
})

test('location column: null shows —, 本地网络 shows itself', async ({ page }) => {
  await open(page, {
    'GET /machines': () =>
      machines([], (m) => {
        if (m.info.hostname === 'core1') m.location = null
      }),
  })
  const loc = (n: string) => page.getByRole('row').filter({ hasText: n }).getByTestId('location-text')
  await expect(loc('core1')).toHaveText('—')
  await expect(loc('core2')).toHaveText('本地网络')
})

test('long emoji alias does not overflow at 390px and keeps the full title', async ({ page }) => {
  const alias = 'A'.repeat(70) + '😀'.repeat(5)
  await page.setViewportSize({ width: 390, height: 800 })
  await open(page, {
    'GET /machines': () =>
      machines([], (m) => {
        if (m.info.hostname === 'core1') m.alias = alias
      }),
  })
  const name = page.getByTestId('device-name').filter({ hasText: 'AAAA' }).first()
  await expect(name).toHaveAttribute('title', alias)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('390px shows cards, not a table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await open(page)
  await expect(page.getByTestId('device-card')).toHaveCount(3)
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('filter chips with counts and search', async ({ page }) => {
  await open(page, { 'GET /machines': () => machines([newMachine()]) })
  await expect(page.getByRole('button', { name: /^全部\s*4$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^未加入网络\s*1$/ })).toBeVisible()
  await page.getByRole('button', { name: /^未加入网络/ }).click()
  await expect(page.getByRole('row')).toHaveCount(2) // header + 1
  await page.getByRole('button', { name: /^全部/ }).click()
  await page.getByRole('searchbox').fill('10.144.144.3')
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(page.getByRole('row').filter({ hasText: 'core3' })).toBeVisible()
})

test('?city= adds a removable location chip', async ({ page }) => {
  await mockApi(page, {
    'GET /machines': () =>
      machines([], (m) => {
        if (m.info.hostname === 'core1') m.location = { country: '中国', region: '浙江', city: '杭州' }
      }),
  })
  await page.goto('/#/devices?city=%E6%9D%AD%E5%B7%9E')
  await expect(page.getByRole('row')).toHaveCount(2)
  const chip = page.getByRole('button', { name: /位置：杭州/ })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page.getByRole('row')).toHaveCount(4)
  await expect(page).not.toHaveURL(/city=/)
})

test('empty inventory explains how to add a device', async ({ page }) => {
  await open(page, { 'GET /machines': () => ({ machines: [] }) })
  await expect(page.getByText('还没有设备')).toBeVisible()
})
