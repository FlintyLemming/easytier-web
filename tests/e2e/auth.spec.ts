import { expect, test } from '@playwright/test'
import { fixture, mockApi, status } from './mockApi'

const core1 = fixture('index.json').machines.core1 as string

test('login submits an MD5 password and lands on the overview', async ({ page }) => {
  let authed = false
  const { requests } = await mockApi(page, {
    'GET /console-info': () => (authed ? fixture('console-info.json') : status(401, { message: 'unauthorized' })),
    'POST /auth/login': () => {
      authed = true
      return {}
    },
  })
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/#\/$/)
  const login = requests.find((r) => r.path === '/auth/login')!
  expect(login.body).toEqual({ username: 'admin', password: '21232f297a57a5a743894a0e4a801fc3' })
})

test('wrong credentials show an inline error (zh-CN)', async ({ page }) => {
  await mockApi(page, {
    'GET /console-info': () => status(401),
    'POST /auth/login': () => status(401, { message: 'bad' }),
  })
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('nope')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('用户名或密码错误')).toBeVisible()
  await expect(page).toHaveURL(/#\/login/)
})

test('wrong credentials show an inline error (en)', async ({ page }) => {
  await mockApi(
    page,
    { 'GET /console-info': () => status(401), 'POST /auth/login': () => status(401) },
    { locale: 'en' },
  )
  await page.goto('/#/login')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('nope')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid username or password')).toBeVisible()
})

test('OIDC button appears when enabled and points at the oidc login endpoint', async ({ page }) => {
  await mockApi(page, {
    'GET /console-info': () => status(401),
    'GET /auth/oidc/config': () => ({ enabled: true }),
  })
  await page.goto('/#/login')
  const sso = page.getByRole('link', { name: /SSO|单点登录/ })
  await expect(sso).toBeVisible()
  expect(await sso.getAttribute('href')).toMatch(/\/api\/v1\/auth\/oidc\/login$/)
})

test('OIDC button is hidden when disabled', async ({ page }) => {
  await mockApi(page, { 'GET /console-info': () => status(401) })
  await page.goto('/#/login')
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  await expect(page.getByRole('link', { name: /SSO|单点登录/ })).toHaveCount(0)
})

test('a 401 on the poller redirects to login exactly once, then re-login returns to the device', async ({ page }) => {
  let authed = true
  await mockApi(page, {
    'GET /console-info': () => (authed ? fixture('console-info.json') : status(401)),
    'GET /machines': () => (authed ? fixture('machines.json') : status(401)),
    'GET /networks': () => (authed ? fixture('networks.json') : status(401)),
    'GET /blocked-devices': () => (authed ? fixture('blocked-devices.json') : status(401)),
    'GET /networks/*/members': () => (authed ? fixture('members.json') : status(401)),
    'POST /auth/login': () => {
      authed = true
      return {}
    },
  })
  // Record every URL the main frame takes (pushState / replaceState / hash changes included).
  const urls: string[] = []
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) urls.push(f.url())
  })

  await page.goto(`/#/devices/${core1}`)
  await expect(page.getByRole('link', { name: '设备', exact: true })).toBeVisible()
  const before = urls.length

  authed = false // session expires; next 5s inventory poll gets 401s
  await expect(page).toHaveURL(/#\/login\?next=%2Fdevices%2F/, { timeout: 15_000 })
  expect(new URL(page.url()).hash).toBe(`#/login?next=%2Fdevices%2F${core1}`)

  // Let any in-flight / extra 401s settle, then count login URLs seen since the session expired.
  await page.waitForTimeout(1500)
  const loginUrls = urls.slice(before).filter((u) => u.includes('/login'))
  expect(loginUrls).toHaveLength(1)

  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(new RegExp(`#/devices/${core1}$`))
})

test('register page shows a refreshable captcha', async ({ page }) => {
  await mockApi(page, { 'GET /console-info': () => status(401) })
  await page.goto('/#/register')
  const img = page.locator('img')
  const first = await img.getAttribute('src')
  expect(first).toMatch(/\/api\/v1\/auth\/captcha\?t=\d+$/)
  await page.waitForTimeout(5)
  await page.getByRole('button', { name: /刷新/ }).click()
  expect(await img.getAttribute('src')).not.toBe(first)
})
