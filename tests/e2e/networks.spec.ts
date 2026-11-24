import { expect, test, type Page } from '@playwright/test'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const HOME = fixture('networks.json').networks[0].network_id as string
const CREATED = fixture('network-created.json').network_id as string
const twoNetworks: Overrides = { 'GET /networks': () => fixture('networks-two.json') }

const creates = (reqs: RecordedRequest[]) => reqs.filter((r) => r.method === 'POST' && r.path === '/networks')

async function openCreate(page: Page) {
  await page.getByRole('button', { name: '新建网络' }).click()
  return page.getByRole('dialog', { name: '新建网络' })
}

test('1: the top nav has 网络; webhook mode hides it and sends /networks back to the overview', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/devices')
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '网络' })).toBeVisible()
})

test('1b: webhook mode has no 网络 tab and /networks returns to the overview without network requests', async ({ page }) => {
  const { requests } = await mockApi(page, {}, { webhook: true })
  await page.goto('/#/networks')
  await expect(page).toHaveURL(/\/#\/$/)
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设备' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '网络' })).toHaveCount(0)
  expect(requests.filter((r) => r.path.startsWith('/networks'))).toEqual([])
})

test('2: with one network /networks opens it; ?list=1 shows the list', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/networks')
  await expect(page).toHaveURL(new RegExp(`/#/networks/${HOME}$`))
  await page.goto('/#/networks?list=1')
  const row = page.getByTestId('network-row').filter({ hasText: 'home-central' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('10.144.144.0/24')
  await expect(row).toContainText('3 / 3')
  await expect(row).toContainText('手动指定节点')
})

test('3: two networks are listed; the secure one has a badge and opens on click', async ({ page }) => {
  await mockApi(page, twoNetworks)
  await page.goto('/#/networks')
  await expect(page.getByTestId('network-row')).toHaveCount(2)
  await expect(page.getByText('2 个网络')).toBeVisible()
  const secure = page.getByTestId('network-row').filter({ hasText: 'fixture-secure' })
  await expect(secure.getByText('安全模式')).toBeVisible()
  await secure.click()
  await expect(page).toHaveURL(new RegExp(`/#/networks/${fixture('network-secure.json').network_id}$`))
})

test('4: no networks shows the empty state', async ({ page }) => {
  await mockApi(page, { 'GET /networks': () => ({ networks: [] }) })
  await page.goto('/#/networks')
  await expect(page.getByText('还没有网络')).toBeVisible()
  await expect(page.getByRole('button', { name: '新建网络' })).toBeVisible()
})

test('5: create a Manual network: url and subnet checks, then the exact request and the redirect', async ({ page }) => {
  const { requests } = await mockApi(page, { ...twoNetworks, 'POST /networks': () => fixture('network-created.json') })
  await page.goto('/#/networks')
  const dialog = await openCreate(page)
  await dialog.getByLabel('显示名').fill('Lab')
  await dialog.getByRole('radio', { name: '手动指定节点' }).check()
  await dialog.getByRole('button', { name: '添加' }).click()
  await dialog.getByRole('textbox', { name: '节点地址 第 1 项' }).fill('foo')
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(dialog.getByText('格式应为 协议://地址:端口')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '创建' })).toBeDisabled()
  await dialog.getByRole('textbox', { name: '节点地址 第 1 项' }).fill('tcp://1.2.3.4:11010')
  const cidr = dialog.getByLabel('网段')
  await cidr.fill('10.9.0.0')
  await cidr.blur()
  await expect(cidr).toHaveValue('10.9.0.0/24')
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(page).toHaveURL(new RegExp(`/#/networks/${CREATED}$`))
  const [req] = creates(requests)
  expect(req!.body).toEqual({
    settings: {
      display_name: 'Lab', network_name: null, networking_method: 'Manual', public_server_url: null,
      peer_urls: ['tcp://1.2.3.4:11010'], virtual_cidr: '10.9.0.0/24', secure_mode: false,
    },
  })
})

test('6: with the gateway enabled the dialog defaults to it with secure mode on; disabled otherwise', async ({ page }) => {
  const { requests } = await mockApi(page, {
    ...twoNetworks,
    'GET /networks/gateway-info': () => ({ enabled: true, peer_url: 'tcp://gw:22020', relay_data: false }),
    'POST /networks': () => fixture('network-created.json'),
  })
  await page.goto('/#/networks')
  const dialog = await openCreate(page)
  await expect(dialog.getByRole('radio', { name: '内置网关' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: '安全模式' })).toBeChecked()
  await dialog.getByLabel('显示名').fill('GW')
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(page).toHaveURL(new RegExp(`/#/networks/${CREATED}$`))
  const body = creates(requests)[0]!.body as { settings: Record<string, unknown> }
  expect(body.settings).toMatchObject({ networking_method: 'Gateway', peer_urls: [], public_server_url: null, secure_mode: true })
})

test('6b: without the gateway its option is disabled', async ({ page }) => {
  await mockApi(page, twoNetworks)
  await page.goto('/#/networks')
  const dialog = await openCreate(page)
  await expect(dialog.getByRole('radio', { name: '内置网关' })).toBeDisabled()
  await expect(dialog.getByText('后端没有开启网关')).toBeVisible()
  await expect(dialog.getByRole('radio', { name: '手动指定节点' })).toBeChecked()
})

test('7: a random secret is sent as network_secret', async ({ page }) => {
  const { requests } = await mockApi(page, { ...twoNetworks, 'POST /networks': () => fixture('network-created.json') })
  await page.goto('/#/networks')
  const dialog = await openCreate(page)
  await dialog.getByLabel('显示名').fill('Lab')
  await dialog.getByRole('radio', { name: '独立' }).check()
  await dialog.getByRole('button', { name: '随机生成' }).click()
  await expect(dialog.getByLabel('网络密钥')).toHaveValue(/^[A-Za-z0-9+/]{43}=$/)
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(page).toHaveURL(new RegExp(`/#/networks/${CREATED}$`))
  const body = creates(requests)[0]!.body as { network_secret?: string }
  expect(body.network_secret).toMatch(/^[A-Za-z0-9+/]{43}=$/)
})

test('8: a failed create keeps the dialog and its input, and shows the backend message', async ({ page }) => {
  await mockApi(page, {
    ...twoNetworks,
    'POST /networks': () => status(409, { message: 'UNIQUE constraint failed: networks.user_id, networks.network_name' }),
  })
  await page.goto('/#/networks')
  const dialog = await openCreate(page)
  await dialog.getByLabel('显示名').fill('Lab')
  await dialog.getByRole('radio', { name: '独立' }).check()
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('创建失败：UNIQUE constraint failed: networks.user_id, networks.network_name')).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('显示名')).toHaveValue('Lab')
})

test('9: narrow screens show cards without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await mockApi(page, twoNetworks)
  await page.goto('/#/networks')
  await expect(page.getByTestId('network-card')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
