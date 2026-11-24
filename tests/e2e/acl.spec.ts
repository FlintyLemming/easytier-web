import { expect, test, type Page } from '@playwright/test'
import type { AclPolicy, AclRule } from '../../src/api/types'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const HOME = fixture('networks.json').networks[0].network_id as string
const M_CORE1 = 'af62c1f3-45f7-4988-9d7c-ea7f8d241428'
const M_CORE2 = '64370283-b14f-4fa4-b63e-bcba1dc63260'
const M_CORE3 = '4d9a9da7-1d93-4633-a299-8d78554a2bfc'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const DENY_SSH = fixture('acl-policy.json').policy.rules[0] as AclRule
/** The Task 2 round-trip rule, on core3 (lab-box). */
const RICH: AclRule = {
  id: 'r9',
  name: 'rich',
  enabled: true,
  action: 'allow',
  sources: [{ type: 'member', member_id: M_CORE3 }, { type: 'group', name: 'member:t1' }],
  destinations: [
    { type: 'subnet', member_id: M_CORE3, cidrs: ['192.168.1.0/24'] },
    { type: 'subnet', member_id: M_CORE3, cidrs: ['192.168.2.0/24'] },
  ],
  protocols: [{ protocol: 'any', ports: ['53'], stateful: false }, { protocol: 'tcp', ports: [], stateful: false }],
}

const policy = (p: AclPolicy): Overrides => ({ [`GET /networks/${HOME}/acl-policy`]: () => ({ policy: p }) })
const puts = (reqs: RecordedRequest[]) => reqs.filter((r) => r.method === 'PUT' && r.path === `/networks/${HOME}/acl-policy`)
const rule = (page: Page, name: string) => page.getByTestId('acl-rule').filter({ hasText: name })

async function openAcl(page: Page, overrides: Overrides = {}) {
  const ctx = await mockApi(page, { [`PUT /networks/${HOME}/acl-policy`]: (req) => ({ policy: req.postDataJSON() }), ...overrides })
  await page.goto(`/#/networks/${HOME}?tab=acl`)
  return ctx
}

test('1: the policy reads as default allow with the deny-lab-ssh rule summarised', async ({ page }) => {
  await openAcl(page)
  await expect(page.getByRole('radio', { name: '默认允许' })).toHaveAttribute('aria-checked', 'true')
  const r = rule(page, 'deny-lab-ssh')
  await expect(r).toContainText('拒绝')
  await expect(r).toContainText('全部成员 → lab-box')
  await expect(r).toContainText('TCP 22 · 有状态')
  await expect(page.getByText('有未保存的修改')).toHaveCount(0)
})

test('2: toggling one rule writes every other rule back exactly as read (Review Focus 1)', async ({ page }) => {
  const { requests } = await openAcl(page, policy({ default_action: 'allow', rules: [RICH, DENY_SSH] }))
  await rule(page, 'deny-lab-ssh').getByRole('switch', { name: '启用 deny-lab-ssh' }).click()
  await expect(page.getByText('有未保存的修改')).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存 ACL')).toBeVisible()
  const body = puts(requests)[0]!.body as AclPolicy
  expect(body.default_action).toBe('allow')
  expect(body.rules[0]).toEqual(RICH)
  expect(body.rules[1]).toEqual({ ...DENY_SSH, enabled: false })
  await expect(page.getByText('有未保存的修改')).toHaveCount(0)
})

test('3: a new rule from the dialog is appended and saved in the backend shape', async ({ page }) => {
  const { requests } = await openAcl(page)
  await page.getByRole('button', { name: '添加规则' }).click()
  const dialog = page.getByRole('dialog', { name: '添加规则' })
  await dialog.getByLabel('名称').fill('web')
  await dialog.getByRole('group', { name: '来源' }).getByRole('checkbox', { name: /core1/ }).check()
  await dialog.getByRole('group', { name: '目标' }).getByRole('checkbox', { name: /^core2/ }).check()
  await dialog.getByLabel('端口 1').fill('80, 443')
  await expect(dialog.getByRole('checkbox', { name: '有状态' })).toBeChecked()
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('acl-rule').last()).toContainText('web')
  await expect(page.getByText('有未保存的修改')).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存 ACL')).toBeVisible()
  const added = (puts(requests)[0]!.body as AclPolicy).rules[1]!
  expect(added.id).toMatch(UUID_V4)
  expect({ ...added, id: 'x' }).toEqual({
    id: 'x', name: 'web', enabled: true, action: 'allow',
    sources: [{ type: 'member', member_id: M_CORE1 }],
    destinations: [{ type: 'member', member_id: M_CORE2 }],
    protocols: [{ protocol: 'tcp', ports: ['80', '443'], stateful: true }],
  })
})

test('4: the rule dialog blocks bad ports, ICMP ports and an empty name', async ({ page }) => {
  await openAcl(page)
  await page.getByRole('button', { name: '添加规则' }).click()
  const dialog = page.getByRole('dialog', { name: '添加规则' })
  await dialog.getByLabel('名称').fill('x')
  await dialog.getByRole('group', { name: '来源' }).getByRole('checkbox', { name: '全部成员' }).check()
  await dialog.getByRole('group', { name: '目标' }).getByRole('checkbox', { name: '全部成员' }).check()
  const done = dialog.getByRole('button', { name: '完成' })
  await expect(done).toBeEnabled()
  for (const bad of ['0', '70000', '90-80', 'abc']) {
    await dialog.getByLabel('端口 1').fill(bad)
    await expect(done).toBeDisabled()
    await expect(dialog.getByText('端口格式不对')).toBeVisible()
  }
  await dialog.getByLabel('端口 1').fill('22')
  await expect(done).toBeEnabled()
  await dialog.getByLabel('协议 1').selectOption('icmp')
  await expect(dialog.getByLabel('端口 1')).toHaveCount(0)
  await expect(done).toBeEnabled()
  await dialog.getByLabel('名称').fill(' ')
  await expect(done).toBeDisabled()
})

test('5: rules move up and down; the move is saved', async ({ page }) => {
  const { requests } = await openAcl(page, policy({ default_action: 'allow', rules: [RICH, DENY_SSH] }))
  await expect(rule(page, 'deny-lab-ssh').getByRole('button', { name: '下移 deny-lab-ssh' })).toHaveCount(0)
  await expect(rule(page, 'rich').getByRole('button', { name: '上移 rich' })).toHaveCount(0)
  await rule(page, 'deny-lab-ssh').getByRole('button', { name: '上移 deny-lab-ssh' }).click()
  await expect(page.getByTestId('acl-rule').first()).toContainText('deny-lab-ssh')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存 ACL')).toBeVisible()
  expect((puts(requests)[0]!.body as AclPolicy).rules.map((r) => r.id)).toEqual([DENY_SSH.id, RICH.id])
})

test('6: default deny without an enabled allow rule asks before saving', async ({ page }) => {
  const { requests } = await openAcl(page)
  await page.getByRole('radio', { name: '默认拒绝' }).click()
  await expect(page.getByText('没有被规则允许的流量都会被拒绝')).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '保存 ACL' })
  await expect(dialog).toContainText('当前设置会拒绝所有流量')
  await dialog.getByRole('button', { name: '取消' }).click()
  expect(puts(requests)).toHaveLength(0)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('dialog', { name: '保存 ACL' }).getByRole('button', { name: '仍然保存' }).click()
  await expect(page.getByText('已保存 ACL')).toBeVisible()
  expect((puts(requests)[0]!.body as AclPolicy).default_action).toBe('deny')
})

test('7: a rejected save shows the backend message and keeps the draft', async ({ page }) => {
  await openAcl(page, { [`PUT /networks/${HOME}/acl-policy`]: () => status(400, { message: 'invalid ACL rule x: invalid port 0' }) })
  await rule(page, 'deny-lab-ssh').getByRole('switch', { name: '启用 deny-lab-ssh' }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('保存失败：invalid ACL rule x: invalid port 0')).toBeVisible()
  await expect(page.getByText('有未保存的修改')).toBeVisible()
})

test('8: unsaved changes survive tab switches and guard leaving the page (Review Focus 5)', async ({ page }) => {
  await openAcl(page)
  await rule(page, 'deny-lab-ssh').getByRole('switch', { name: '启用 deny-lab-ssh' }).click()
  const tabs = page.getByRole('tablist', { name: '网络详情' })
  await tabs.getByRole('tab', { name: '成员' }).click()
  await tabs.getByRole('tab', { name: 'ACL' }).click()
  await expect(page.getByText('有未保存的修改')).toBeVisible()
  const url = page.url()
  const devices = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设备' })
  await devices.click()
  const ask = page.getByRole('dialog', { name: '放弃未保存的 ACL 修改？' })
  await ask.getByRole('button', { name: '取消' }).click()
  expect(page.url()).toBe(url)
  await expect(page.getByText('有未保存的修改')).toBeVisible()
  await devices.click()
  await page.getByRole('dialog', { name: '放弃未保存的 ACL 修改？' }).getByRole('button', { name: '放弃修改' }).click()
  await expect(page).toHaveURL(/\/#\/devices$/)
})

test('9: 放弃修改 restores the saved policy', async ({ page }) => {
  await openAcl(page)
  const toggle = rule(page, 'deny-lab-ssh').getByRole('switch', { name: '启用 deny-lab-ssh' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: '放弃修改' }).click()
  await expect(page.getByText('有未保存的修改')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
})

test('10: a failed read shows an error with retry', async ({ page }) => {
  await openAcl(page, { [`GET /networks/${HOME}/acl-policy`]: () => status(500, { message: 'boom' }) })
  await expect(page.getByText('读取 ACL 失败')).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
})

test('final-3: back on the ACL tab without unsaved changes, the policy is read again', async ({ page }) => {
  const state = { pruned: false }
  const { requests } = await openAcl(page, {
    [`GET /networks/${HOME}/acl-policy`]: () => ({ policy: state.pruned ? { default_action: 'allow', rules: [] } : fixture('acl-policy.json').policy }),
  })
  await expect(rule(page, 'deny-lab-ssh')).toBeVisible()
  const tabs = page.getByRole('tablist', { name: '网络详情' })
  await tabs.getByRole('tab', { name: '成员' }).click()
  state.pruned = true // e.g. lab-box was removed and the backend pruned its rule
  await tabs.getByRole('tab', { name: 'ACL' }).click()
  await expect(page.getByText('还没有规则')).toBeVisible()
  expect(requests.filter((r) => r.method === 'GET' && r.path === `/networks/${HOME}/acl-policy`).length).toBeGreaterThanOrEqual(2)
})
