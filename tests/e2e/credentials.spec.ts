import { expect, test, type Page } from '@playwright/test'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const HOME = fixture('networks.json').networks[0].network_id as string
const SECURE = fixture('network-secure.json').network_id as string
const CRED = fixture('credentials.json').credentials.find((c: { credential_id: string }) => c.credential_id === 'fixture-cred')
const MEMBER_CRED = fixture('credentials.json').credentials.find((c: { credential_id: string }) => c.credential_id.startsWith('member-'))
const CLI = `easytier-core --network-name fixture-secure --secure-mode --credential ${CRED.credential_secret}`

const secureApi: Overrides = {
  'GET /networks': () => fixture('networks-two.json'),
  [`GET /networks/${SECURE}`]: () => fixture('network-secure.json'),
  [`GET /networks/${SECURE}/members`]: () => fixture('members-secure.json'),
}

async function openCredentials(page: Page, overrides: Overrides = {}) {
  const ctx = await mockApi(page, { ...secureApi, ...overrides })
  await page.goto(`/#/networks/${SECURE}?tab=credentials`)
  return ctx
}

const row = (page: Page, id: string) => page.getByTestId('credential-row').filter({ hasText: id })
async function rowAction(page: Page, id: string, item: string) {
  await row(page, id).getByRole('button', { name: `${id} 的操作` }).click()
  await page.getByRole('menuitem', { name: item }).click()
}
const credentialReads = (reqs: RecordedRequest[]) => reqs.filter((r) => r.method === 'GET' && r.path === `/networks/${SECURE}/credentials`)

test('1: the list shows every credential; a temporary member’s cannot be revoked', async ({ page }) => {
  await openCredentials(page)
  await expect(page.getByTestId('credential-row')).toHaveCount(3)
  await expect(page.getByText('3 个凭据')).toBeVisible()
  await expect(row(page, MEMBER_CRED.credential_id)).toContainText('临时成员 core3')
  await expect(row(page, 'fixture-cred')).toContainText('可复用')
  await expect(row(page, 'fixture-cred')).toContainText('后到期')
  await row(page, MEMBER_CRED.credential_id).getByRole('button', { name: `${MEMBER_CRED.credential_id} 的操作` }).click()
  await expect(page.getByRole('menuitem', { name: /吊销…/ })).toHaveAttribute('data-disabled', '')
  await expect(page.getByRole('menuitem', { name: /吊销…/ })).toContainText('移出这个临时成员即可吊销')
})

test('2: join info shows the CLI and TOML forms, a masked secret, and copies', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openCredentials(page)
  await rowAction(page, 'fixture-cred', '接入信息…')
  const dialog = page.getByRole('dialog', { name: '接入信息 · fixture-cred' })
  await expect(dialog.getByRole('textbox')).toHaveValue(CLI)
  await expect(dialog.getByText('这个网络没有节点地址')).toBeVisible()
  await dialog.getByRole('radio', { name: '配置文件' }).click()
  await expect(dialog.getByRole('textbox')).toHaveValue(/local_private_key = "/)
  await expect(dialog.getByRole('textbox')).not.toHaveValue(/\[\[peer\]\]/)
  await expect(dialog.getByText(CRED.credential_secret, { exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '显示' }).click()
  await expect(dialog.getByText(CRED.credential_secret, { exact: true })).toBeVisible()
  await dialog.getByRole('radio', { name: '命令行' }).click()
  await dialog.getByRole('button', { name: '复制命令行' }).click()
  await expect(page.getByText('已复制')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CLI)
})

test('3: generating sends ttl, reusable and the custom id, then opens the join info', async ({ page }) => {
  const { requests } = await openCredentials(page, { [`POST /networks/${SECURE}/credentials`]: () => fixture('credential-created.json') })
  await page.getByRole('button', { name: '生成凭据' }).click()
  const dialog = page.getByRole('dialog', { name: '生成凭据' })
  await dialog.getByLabel('有效期').selectOption({ label: '7 天' })
  await dialog.getByRole('checkbox', { name: '可以重复使用' }).uncheck()
  await dialog.getByLabel('自定义 ID').fill('guest')
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.getByText('已生成凭据')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '接入信息 · fixture-cred' })).toBeVisible()
  const post = requests.find((r) => r.method === 'POST' && r.path === `/networks/${SECURE}/credentials`)
  expect(post!.body).toEqual({ ttl_seconds: 604800, reusable: false, credential_id: 'guest' })
})

test('4: a failed generate keeps the dialog and its input', async ({ page }) => {
  await openCredentials(page, { [`POST /networks/${SECURE}/credentials`]: () => status(409, { message: 'credential already exists: guest' }) })
  await page.getByRole('button', { name: '生成凭据' }).click()
  const dialog = page.getByRole('dialog', { name: '生成凭据' })
  await dialog.getByLabel('自定义 ID').fill('guest')
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.getByText('生成失败：credential already exists: guest')).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('自定义 ID')).toHaveValue('guest')
})

test('5: revoking asks first, then deletes; a refusal shows the message', async ({ page }) => {
  const answer = { fail: false }
  const { requests } = await openCredentials(page, {
    [`DELETE /networks/${SECURE}/credentials/*`]: () => (answer.fail ? status(409, { message: 'credential is used by a network member: x' }) : {}),
  })
  await rowAction(page, 'fixture-cred', '吊销…')
  const dialog = page.getByRole('dialog', { name: '吊销凭据' })
  await expect(dialog).toContainText('fixture-cred')
  await dialog.getByRole('button', { name: '吊销' }).click()
  await expect(page.getByText('已吊销 fixture-cred')).toBeVisible()
  expect(requests.some((r) => r.method === 'DELETE' && r.path === `/networks/${SECURE}/credentials/fixture-cred`)).toBe(true)
  answer.fail = true
  await rowAction(page, 'fixture-cred', '吊销…')
  await page.getByRole('dialog', { name: '吊销凭据' }).getByRole('button', { name: '吊销' }).click()
  await expect(page.getByText('吊销失败：credential is used by a network member: x')).toBeVisible()
})

test('6: the list polls while visible and stops on another tab', async ({ page }) => {
  const { requests } = await openCredentials(page)
  await expect.poll(() => credentialReads(requests).length, { timeout: 8000 }).toBeGreaterThanOrEqual(2)
  await page.getByRole('tablist', { name: '网络详情' }).getByRole('tab', { name: '成员' }).click()
  await page.waitForTimeout(300)
  const before = credentialReads(requests).length
  await page.waitForTimeout(6000)
  expect(credentialReads(requests).length).toBe(before)
})

test('7: a network without secure mode ignores ?tab=credentials', async ({ page }) => {
  const { requests } = await mockApi(page)
  await page.goto(`/#/networks/${HOME}?tab=credentials`)
  await expect(page.getByTestId('member-row')).toHaveCount(3)
  expect(requests.filter((r) => r.path.endsWith('/credentials'))).toEqual([])
})
