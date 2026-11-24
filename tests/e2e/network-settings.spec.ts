import { expect, test, type Page } from '@playwright/test'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const HOME = fixture('networks.json').networks[0].network_id as string
const SETTINGS = {
  display_name: 'home-central', network_name: null, networking_method: 'Manual', public_server_url: null,
  peer_urls: ['tcp://core1:11010'], virtual_cidr: '10.144.144.0/24', secure_mode: false,
}

const patches = (reqs: RecordedRequest[]) => reqs.filter((r) => r.method === 'PATCH' && r.path === `/networks/${HOME}`)

async function openSettings(page: Page, overrides: Overrides = {}) {
  const ctx = await mockApi(page, { [`PATCH /networks/${HOME}`]: () => fixture('network.json'), ...overrides })
  await page.goto(`/#/networks/${HOME}?tab=settings`)
  await expect(page.getByLabel('显示名')).toHaveValue('home-central')
  return ctx
}
const saveButton = (page: Page) => page.getByRole('button', { name: '保存', exact: true })

test('1: the form shows the stored settings and 保存 waits for a change', async ({ page }) => {
  await openSettings(page)
  await expect(page.getByLabel('网络名')).toHaveValue('home-central')
  await expect(page.getByRole('radio', { name: '手动指定节点' })).toBeChecked()
  await expect(page.getByRole('textbox', { name: '节点地址 第 1 项' })).toHaveValue('tcp://core1:11010')
  await expect(page.getByLabel('网段')).toHaveValue('10.144.144.0/24')
  await expect(page.getByRole('checkbox', { name: '安全模式' })).not.toBeChecked()
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.getByText('修改网络名会让所有成员重新连接')).toBeVisible()
})

test('2: a display-name change saves without asking, keeping the name and secret', async ({ page }) => {
  const { requests } = await openSettings(page)
  await page.getByLabel('显示名').fill('Home')
  await saveButton(page).click()
  await expect(page.getByText('已保存网络设置')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(patches(requests)[0]!.body).toEqual({ settings: { ...SETTINGS, display_name: 'Home' } })
})

test('3: a subnet change asks first and lists the IP reassignment', async ({ page }) => {
  const { requests } = await openSettings(page)
  await page.getByLabel('网段').fill('10.150.0.0/24')
  await saveButton(page).click()
  const dialog = page.getByRole('dialog', { name: '保存网络设置' })
  await expect(dialog).toContainText('所有自动分配的 IP 会重新分配')
  await dialog.getByRole('button', { name: '取消' }).click()
  expect(patches(requests)).toHaveLength(0)
  await saveButton(page).click()
  await page.getByRole('dialog', { name: '保存网络设置' }).getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('已保存网络设置')).toBeVisible()
  expect((patches(requests)[0]!.body as { settings: { virtual_cidr: string } }).settings.virtual_cidr).toBe('10.150.0.0/24')
})

test('4: removing the last peer URL is an error and blocks saving', async ({ page }) => {
  await openSettings(page)
  await page.getByRole('group', { name: '节点地址' }).getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('必填')).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()
})

test('5: a rejected save shows the backend message and keeps the edit', async ({ page }) => {
  await openSettings(page, { [`PATCH /networks/${HOME}`]: () => status(400, { message: 'invalid network URL: foo' }) })
  await page.getByLabel('显示名').fill('Home')
  await saveButton(page).click()
  await expect(page.getByText('保存失败：invalid network URL: foo')).toBeVisible()
  await expect(page.getByLabel('显示名')).toHaveValue('Home')
})

test('6: the secret is masked; regenerating sends the stored settings with a new secret', async ({ page }) => {
  const { requests } = await openSettings(page)
  const secret = page.getByTestId('network-secret')
  await expect(secret).not.toContainText('home-secret')
  await secret.getByRole('button', { name: '显示' }).click()
  await expect(secret).toContainText('home-secret')
  await page.getByLabel('显示名').fill('Unsaved')
  await secret.getByRole('button', { name: '重新生成…' }).click()
  await page.getByRole('dialog', { name: '重新生成网络密钥' }).getByRole('button', { name: '重新生成' }).click()
  await expect(page.getByText('已重新生成网络密钥')).toBeVisible()
  const body = patches(requests)[0]!.body as { settings: unknown; network_secret: string }
  expect(body.settings).toEqual(SETTINGS)
  expect(body.network_secret).toMatch(/^[A-Za-z0-9+/]{43}=$/)
})

test('7: deleting the network asks with the member count, then returns to the list', async ({ page }) => {
  const { requests } = await openSettings(page)
  await page.getByRole('button', { name: '删除网络…' }).click()
  const dialog = page.getByRole('dialog', { name: '删除网络' })
  await expect(dialog).toContainText('3 个成员')
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByText('已删除 home-central')).toBeVisible()
  await expect(page).toHaveURL(/\/#\/networks\?list=1$/)
  expect(requests.some((r) => r.method === 'DELETE' && r.path === `/networks/${HOME}`)).toBe(true)
})

test('8: a Gateway network stays Gateway even with the gateway off', async ({ page }) => {
  const gw = { ...fixture<object>('network.json'), networking_method: 'Gateway', peer_urls: ['tcp://gw:22020'] }
  const { requests } = await openSettings(page, { [`GET /networks/${HOME}`]: () => gw, [`PATCH /networks/${HOME}`]: () => gw })
  await expect(page.getByRole('radio', { name: '内置网关' })).toBeChecked()
  await page.getByLabel('显示名').fill('Home')
  await saveButton(page).click()
  await expect(page.getByText('已保存网络设置')).toBeVisible()
  expect((patches(requests)[0]!.body as { settings: unknown }).settings).toMatchObject({ networking_method: 'Gateway', peer_urls: [], public_server_url: null })
})
