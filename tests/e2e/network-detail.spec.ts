import { expect, test, type Page } from '@playwright/test'
import { strToUuid } from '../../src/lib/uuid'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const HOME = fixture('networks.json').networks[0].network_id as string
const SECURE = fixture('network-secure.json').network_id as string
const CORE2 = '22222222-2222-4222-8222-222222222222'
const SPARE = '44444444-4444-4444-8444-444444444444'

/** machines.json plus an online device that is in no network. */
function machinesWithSpare() {
  const base = fixture('machines.json')
  const spare = structuredClone(base.machines[0])
  spare.info.machine_id = strToUuid(SPARE)
  spare.info.hostname = 'spare-box'
  spare.info.running_network_instances = []
  spare.networks = []
  spare.client_url = 'udp://192.168.97.9:50000'
  base.machines.push(spare)
  return base
}

const secureApi: Overrides = {
  'GET /networks': () => fixture('networks-two.json'),
  [`GET /networks/${SECURE}`]: () => fixture('network-secure.json'),
  [`GET /networks/${SECURE}/members`]: () => fixture('members-secure.json'),
}

const memberAdds = (reqs: RecordedRequest[], id: string) => reqs.filter((r) => r.method === 'POST' && r.path === `/networks/${id}/members`)
const row = (page: Page, name: string) => page.getByTestId('member-row').filter({ hasText: name })

test('1: header, members table and the breadcrumb back to the list', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/#/networks/${HOME}`)
  await expect(page.getByRole('heading', { level: 1, name: 'home-central' })).toBeVisible()
  const sub = page.getByTestId('network-subline')
  await expect(sub).toContainText('home-central')
  await expect(sub).toContainText('手动指定节点')
  await expect(sub).toContainText('10.144.144.0/24')
  await expect(sub).toContainText('3 / 3 在线')
  await expect(page.getByTestId('member-row')).toHaveCount(3)
  await expect(row(page, 'core1')).toContainText('固定')
  await expect(row(page, 'core2')).toContainText('自动分配')
  for (const n of ['core1', 'core2', 'lab-box']) await expect(row(page, n)).toContainText('运行中')
  await expect(page.getByRole('link', { name: '网络', exact: true }).last()).toHaveAttribute('href', '#/networks?list=1')
})

test('2: no 凭据 tab without secure mode; tabs live in the query and Back returns', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/#/networks/${HOME}`)
  const tabs = page.getByRole('tablist', { name: '网络详情' })
  await expect(tabs.getByRole('tab')).toHaveText(['成员', 'ACL', '设置'])
  await tabs.getByRole('tab', { name: 'ACL' }).click()
  await expect(page).toHaveURL(/tab=acl/)
  await expect(tabs.getByRole('tab', { name: 'ACL' })).toHaveAttribute('aria-selected', 'true')
  await page.goBack()
  await expect(page).not.toHaveURL(/tab=/)
  await expect(tabs.getByRole('tab', { name: '成员' })).toHaveAttribute('aria-selected', 'true')
})

test('3: a member row opens the device in this network', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/#/networks/${HOME}`)
  await row(page, 'core2').click()
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE2}/networks/${HOME}$`))
})

test('4: an unknown network shows not-found with a way back', async ({ page }) => {
  await mockApi(page, { 'GET /networks/nope': () => status(404, { message: 'network not found: nope' }) })
  await page.goto('/#/networks/nope')
  await expect(page.getByText('找不到这个网络')).toBeVisible()
  await expect(page.getByRole('link', { name: '返回网络列表' })).toHaveAttribute('href', '#/networks?list=1')
})

test('5: removing a member warns about ACL rules and deletes it', async ({ page }) => {
  const { requests } = await mockApi(page)
  await page.goto(`/#/networks/${HOME}`)
  await row(page, 'core2').getByRole('button', { name: 'core2 的操作' }).click()
  await page.getByRole('menuitem', { name: '移出此网络…' }).click()
  const dialog = page.getByRole('dialog', { name: '移出成员' })
  await expect(dialog).toContainText('core2')
  await expect(dialog).toContainText('引用它的 ACL 规则也会被修改')
  await dialog.getByRole('button', { name: '移出' }).click()
  await expect(page.getByText('已移出 core2')).toBeVisible()
  expect(requests.some((r) => r.method === 'DELETE' && r.path === `/networks/${HOME}/members/${CORE2}`)).toBe(true)
})

test('6: add members lists only outsiders; no temporary option without secure mode', async ({ page }) => {
  const { requests } = await mockApi(page, { 'GET /machines': () => machinesWithSpare() })
  await page.goto(`/#/networks/${HOME}`)
  await page.getByRole('button', { name: '添加成员' }).click()
  const dialog = page.getByRole('dialog', { name: '添加成员' })
  await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await expect(dialog.getByText('作为临时成员加入')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '添加 0 台设备' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /spare-box/ }).check()
  await dialog.getByRole('button', { name: '添加 1 台设备' }).click()
  await expect(page.getByText('已添加 1 台设备')).toBeVisible()
  expect(memberAdds(requests, HOME)[0]!.body).toEqual({ device_ids: [SPARE], temporary: false })
})

test('7: a secure network has 凭据, temporary members, and temporary adds with a TTL', async ({ page }) => {
  const { requests } = await mockApi(page, { ...secureApi, 'GET /machines': () => machinesWithSpare() })
  await page.goto(`/#/networks/${SECURE}`)
  await expect(page.getByRole('tab', { name: '凭据' })).toBeVisible()
  const temp = row(page, 'core3')
  await expect(temp.getByText('临时', { exact: true })).toBeVisible()
  await expect(temp).toContainText('到期')
  await page.getByRole('button', { name: '添加成员' }).click()
  const dialog = page.getByRole('dialog', { name: '添加成员' })
  // core1, core2 and spare-box are not in the secure network.
  await expect(dialog.getByRole('checkbox', { name: /spare-box/ })).toBeVisible()
  await dialog.getByRole('checkbox', { name: /spare-box/ }).check()
  await dialog.getByRole('checkbox', { name: '作为临时成员加入' }).check()
  await dialog.getByLabel('有效期').selectOption({ label: '30 天' })
  await dialog.getByRole('button', { name: '添加 1 台设备' }).click()
  await expect(page.getByText('已添加 1 台设备')).toBeVisible()
  expect(memberAdds(requests, SECURE)[0]!.body).toEqual({ device_ids: [SPARE], temporary: true, ttl_seconds: 2592000 })
})

test('8: a failed add keeps the dialog and the selection', async ({ page }) => {
  await mockApi(page, {
    'GET /machines': () => machinesWithSpare(),
    [`POST /networks/${HOME}/members`]: () => status(409, { message: 'device already belongs to network: x' }),
  })
  await page.goto(`/#/networks/${HOME}`)
  await page.getByRole('button', { name: '添加成员' }).click()
  const dialog = page.getByRole('dialog', { name: '添加成员' })
  await dialog.getByRole('checkbox', { name: /spare-box/ }).check()
  await dialog.getByRole('button', { name: '添加 1 台设备' }).click()
  await expect(page.getByText('添加失败：device already belongs to network: x')).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /spare-box/ })).toBeChecked()
})

test('9: temporary peers are listed under the members', async ({ page }) => {
  const expiry = Math.floor(Date.now() / 1000) + 86_400
  await mockApi(page, {
    [`GET /networks/${HOME}/members`]: () => ({
      ...fixture<object>('members.json'),
      temporary_peers: [{ peer_id: 9, credential_id: 'fixture-cred', credential_expiry_unix: expiry, hostname: 'guest-laptop', ipv4: '10.144.144.99', version: '2.7.1' }],
    }),
  })
  await page.goto(`/#/networks/${HOME}`)
  const peers = page.getByTestId('temporary-peers')
  await expect(peers).toContainText('临时节点')
  await expect(peers).toContainText('guest-laptop')
  await expect(peers).toContainText('10.144.144.99')
  await expect(peers).toContainText('fixture-cred')
})

test('10: narrow screens show member cards without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await mockApi(page)
  await page.goto(`/#/networks/${HOME}`)
  await expect(page.getByTestId('member-card')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('final-2: going straight from one network to another shows the second one’s members', async ({ page }) => {
  await mockApi(page, secureApi)
  await page.goto(`/#/networks/${HOME}`)
  await expect(page.getByTestId('member-row')).toHaveCount(3)
  await page.goto(`/#/networks/${SECURE}`)
  await expect(page.getByRole('heading', { level: 1, name: 'fixture-secure' })).toBeVisible()
  await expect(page.getByTestId('member-row')).toHaveCount(1)
})
