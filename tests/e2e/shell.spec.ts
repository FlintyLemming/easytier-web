import { expect, test } from '@playwright/test'
import { fixture, mockApi } from './mockApi'

const CORE1 = '11111111-1111-4111-8111-111111111111'

test('top nav shows the 设备 tab and no 网络 tab', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/devices')
  const nav = page.getByRole('navigation')
  await expect(nav.getByRole('link', { name: '设备', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '网络' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: '概览' })).toHaveCount(0)
})

test('添加设备 is the only orange-background element and shows the enroll command', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/devices')
  const add = page.getByRole('button', { name: '添加设备' })
  await expect(add).toBeVisible()
  const orange = await page.evaluate(
    () => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).backgroundColor === 'rgb(245, 78, 0)').length,
  )
  expect(orange).toBe(1)
  expect(await add.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(245, 78, 0)')

  await add.click()
  const info = fixture('console-info.json')
  const host = new URL(page.url()).hostname
  const expected = `easytier-core --config-server ${info.config_server_protocol}://${host}:${info.config_server_port}/${info.username}`
  await expect(page.getByText(expected, { exact: true })).toBeVisible()
})

test('blocked bell shows a count badge and unblocks a device', async ({ page }) => {
  const { requests } = await mockApi(page)
  await page.goto('/#/devices')
  const bell = page.getByRole('button', { name: '被拉黑的设备' })
  await expect(bell).toBeVisible()
  await expect(bell.getByText('1', { exact: true })).toBeVisible()
  await bell.click()
  await page.getByRole('button', { name: '解除拉黑' }).click()
  const id = fixture('blocked-devices.json').blocked[0].id
  await expect.poll(() => requests.some((r) => r.method === 'DELETE' && r.path === `/blocked-devices/${id}`)).toBe(true)
})

test('webhook banner appears when webhook_auth is true', async ({ page }) => {
  await mockApi(page, {}, { webhook: true })
  await page.goto('/#/devices')
  await expect(page.getByTestId('webhook-banner')).toHaveText('当前后端运行在 webhook 模式，部分功能不可用')
  // The list still loads although every /networks* route 404s.
  await expect(page.getByTestId('device-name')).toHaveCount(3)
})

test('webhook banner is absent in central mode', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/devices')
  await expect(page.getByRole('button', { name: '添加设备' })).toBeVisible()
  await expect(page.getByTestId('webhook-banner')).toHaveCount(0)
})

test('user menu switches language to English and persists it', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/devices')
  await page.getByRole('button', { name: '用户菜单' }).click()
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page.getByRole('button', { name: 'Add device' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('et.locale'))).toBe('en')
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
})

test('change password submits an MD5 hash', async ({ page }) => {
  const { requests } = await mockApi(page)
  await page.goto('/#/devices')
  await page.getByRole('button', { name: '用户菜单' }).click()
  await page.getByRole('menuitem', { name: '修改密码' }).click()
  await page.getByLabel('新密码', { exact: true }).fill('admin')
  await page.getByLabel('确认新密码').fill('admin')
  await page.getByRole('button', { name: '保存' }).click()
  await expect.poll(() => requests.find((r) => r.method === 'PUT' && r.path === '/auth/password')?.body).toEqual({
    new_password: '21232f297a57a5a743894a0e4a801fc3',
  })
})

test('below 640px the tabs collapse into a menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await mockApi(page)
  await page.goto(`/#/devices/${CORE1}`)
  await expect(page.getByRole('heading', { name: 'core1' })).toBeVisible()
  // Tabs hidden; logo, 添加设备, bell and avatar stay in the bar.
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
  for (const name of ['添加设备', '被拉黑的设备', '用户菜单']) await expect(page.getByRole('button', { name })).toBeVisible()
  await expect(page.getByRole('link', { name: 'EasyTier' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const menu = page.getByRole('button', { name: '导航菜单' })
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).not.toHaveAttribute('aria-controls')

  // Esc closes and returns focus to the button.
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByTestId('nav-panel')
  await expect(menu).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()

  // Clicking 设备 in the panel navigates and closes it.
  await menu.click()
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设备' }).click()
  await expect(page).toHaveURL(/#\/devices$/)
  await expect(panel).toHaveCount(0)
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('at 640px and wider the tabs show and the menu button is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 })
  await mockApi(page)
  await page.goto('/#/devices')
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设备' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导航菜单' })).toBeHidden()
})
