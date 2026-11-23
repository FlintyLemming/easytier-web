import { expect, test } from '@playwright/test'
import { fixture, mockApi } from './mockApi'

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
