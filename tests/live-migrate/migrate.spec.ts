import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { stripSourceTable } from '../../src/domain/migration/compare'
import { uuidToStr, type UUID } from '../../src/lib/uuid'

/**
 * Live rehearsal of the migration wizard on the data-migrate testenv (plan 6 Task 8). Migrates the
 * office group (core1..3; core4 stays), verifies, rolls core3 back. Does NOT restore anything: the
 * whole-environment rollback (testenv/README.md) does that.
 */

const DATA_DIR = fileURLToPath(new URL('../../testenv/data-migrate/', import.meta.url))
const PREPARE = 'Prepare the data-migrate env first: testenv/README.md 「迁移演练环境」 (fresh seed, upgraded to v2.7.1, core4 running).'
/** Written for the rehearsal report (testenv/reports/migrate-rehearsal-*.md). */
const OBSERVED = fileURLToPath(new URL('../../test-results/migrate-rehearsal-observed.json', import.meta.url))

const DEV = {
  core1: '11111111-1111-4111-8111-111111111111',
  core2: '22222222-2222-4222-8222-222222222222',
  core3: '33333333-3333-4333-8333-333333333333',
  core4: '44444444-4444-4444-8444-444444444444',
} as const
type Name = keyof typeof DEV

interface SeedState { [machineId: string]: Record<string, string> }
interface Snapshot { instances: Record<string, { toml?: string }> }

const seedState = JSON.parse(readFileSync(DATA_DIR + 'seed-state.json', 'utf8')) as SeedState
const snapshot = JSON.parse(readFileSync(DATA_DIR + 'seed-snapshot.json', 'utf8')) as Snapshot
const officeOf = (n: Name) => seedState[DEV[n]]!.office!
const LAB_OLD = seedState[DEV.core1]!['lab-old']!

async function loginUi(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('et.locale', 'zh-CN') } catch { /* ignore */ }
  })
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/#\/$/)
}

async function json<T>(req: APIRequestContext, method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> {
  const res = method === 'GET' ? await req.get('/api/v1' + path) : await req.post('/api/v1' + path, { data })
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T
}
async function instances(req: APIRequestContext, n: Name): Promise<{ running: string[]; disabled: string[] }> {
  const l = await json<{ running_inst_ids?: UUID[]; disabled_inst_ids?: UUID[] }>(req, 'GET', `/machines/${DEV[n]}/networks`)
  return { running: (l.running_inst_ids ?? []).map(uuidToStr), disabled: (l.disabled_inst_ids ?? []).map(uuidToStr) }
}
async function nodeToml(req: APIRequestContext, n: Name, inst: string): Promise<string> {
  const r = await json<{ node_info?: { config?: string } }>(req, 'POST', `/machines/${DEV[n]}/proxy-rpc`, {
    service_name: 'api.instance.PeerManageRpcService',
    method_name: 'show_node_info',
    payload: { instance: { id: strToParts(inst) } },
  })
  return r.node_info?.config ?? ''
}
function strToParts(id: string) {
  const h = id.replace(/-/g, '')
  return { part1: parseInt(h.slice(0, 8), 16), part2: parseInt(h.slice(8, 16), 16), part3: parseInt(h.slice(16, 24), 16), part4: parseInt(h.slice(24), 16) }
}

const card = (page: Page, name: string) => page.getByTestId('device-preview').filter({ has: page.getByRole('heading', { name, exact: true }) })
const execRow = (page: Page, name: string) => page.getByTestId('execute-device').filter({ hasText: name })
const reportStatus = (page: Page, name: string) => page.getByTestId('report-device').filter({ hasText: name }).getByTestId('report-status')

test('live migration rehearsal: office group, verify, roll back core3', async ({ page }) => {
  const observed: Record<string, unknown> = { startedAt: new Date().toISOString() }
  const t0 = Date.now()
  const mark = (k: string) => (observed[`${k}Ms`] = Date.now() - t0)
  try {
    await rehearse(page, observed, mark)
  } finally {
    observed.finishedAt = new Date().toISOString()
    writeFileSync(OBSERVED, JSON.stringify(observed, null, 2) + '\n')
  }
})

async function rehearse(page: Page, observed: Record<string, unknown>, mark: (k: string) => void) {
  await loginUi(page)
  const req = page.request

  // Precondition: the data-migrate env, untouched since the upgrade.
  const machines = await json<{ machines: { online: boolean; info?: { machine_id: UUID } }[] }>(req, 'GET', '/machines')
  const online = machines.machines.filter((m) => m.online && m.info).map((m) => uuidToStr(m.info!.machine_id))
  expect(online, `core4 must be online. ${PREPARE}`).toContain(DEV.core4)
  expect((await instances(req, 'core1')).running, `core1 must run its office legacy instance. ${PREPARE}`).toContain(officeOf('core1'))
  const before = await json<{ networks: { network_name: string }[] }>(req, 'GET', '/networks')
  expect(before.networks.map((n) => n.network_name), `no central network office yet. ${PREPARE}`).not.toContain('office')

  // Step 1–2.
  await page.goto('/#/migrate')
  const group = page.getByTestId('legacy-group').filter({ hasText: 'office' })
  await group.getByRole('button', { name: '迁移这一组' }).click({ timeout: 120_000 })
  const network = page.getByTestId('wizard-step-network')
  await expect(network.getByLabel('网络名')).toHaveValue('office')
  await expect(network.getByLabel('网段')).toHaveValue('10.150.0.0/24')
  await network.getByRole('button', { name: '下一步' }).click()
  mark('inventory')

  // Step 3: default choices, the category-3 changes, confirm all.
  await expect(page.getByTestId('wizard-step-preview')).toBeVisible()
  for (const n of ['core1', 'core2', 'core3']) await expect(card(page, n).getByRole('radio', { name: '迁移', exact: true })).toBeChecked()
  await expect(card(page, 'core4').getByRole('radio', { name: '暂不迁移', exact: true })).toBeChecked()
  const changes: Record<string, string[]> = {}
  for (const n of ['core1', 'core2', 'core3', 'core4']) {
    changes[n] = await card(page, n).getByTestId('changes').locator('li > span').allInnerTexts()
  }
  observed.changes = changes
  observed.summary = await page.getByTestId('change-summary').innerText()
  const labels = (n: string) => changes[n]!.map((c) => c.split('：')[0])
  expect(labels('core1')).toEqual(['连接方式', 'VPN Portal'])
  expect(labels('core2')).toEqual([])
  expect(labels('core3')).toEqual(['ACL'])
  for (const box of await page.getByRole('checkbox', { name: '我已了解' }).all()) await box.check()
  await page.getByTestId('wizard-step-preview').getByRole('button', { name: '下一步' }).click()

  // Step 4.
  const exec = page.getByTestId('wizard-step-execute')
  await exec.getByLabel('我已经按升级手册备份了 et.db').check()
  const [download] = await Promise.all([page.waitForEvent('download'), exec.getByRole('button', { name: '下载备份并开始迁移' }).click()])
  observed.exportFile = download.suggestedFilename()
  const runStart = Date.now()
  for (const n of ['core1', 'core2', 'core3']) await expect(execRow(page, n)).toHaveText(/已迁移$/, { timeout: 300_000 })
  observed.runMs = Date.now() - runStart
  mark('migrated')
  observed.rows = await page.getByTestId('execute-device').allInnerTexts()

  // Backend state after the run.
  const nets = await json<{ networks: { network_id: string; network_name: string }[] }>(req, 'GET', '/networks')
  const office = nets.networks.find((n) => n.network_name === 'office')
  expect(office, 'network office exists').toBeTruthy()
  const netId = office!.network_id
  observed.networkId = netId
  const { members } = await json<{ members: { device_id: string; running: boolean; virtual_ipv4: string | null; hostname_override: string | null }[] }>(
    req, 'GET', `/networks/${netId}/members`)
  const byDev = (n: Name) => members.find((m) => m.device_id === DEV[n])
  for (const [n, ip] of [['core1', '10.150.0.1'], ['core2', '10.150.0.2'], ['core3', '10.150.0.3']] as const) {
    expect(byDev(n)?.running, `${n} running`).toBe(true)
    expect(byDev(n)?.virtual_ipv4?.split('/')[0], `${n} fixed IP`).toBe(ip)
  }
  expect(byDev('core2')?.hostname_override).toBe('core2-office')
  expect(byDev('core4')).toBeUndefined()
  for (const n of ['core1', 'core2', 'core3'] as const) {
    const l = await instances(req, n)
    expect([...l.running, ...l.disabled], `${n} has no office legacy instance`).not.toContain(officeOf(n))
  }
  const c4 = await instances(req, 'core4')
  expect([...c4.running, ...c4.disabled]).toContain(officeOf('core4'))
  const c1 = await instances(req, 'core1')
  expect([...c1.running, ...c1.disabled]).toContain(LAB_OLD)

  // Step 5: verification.
  await exec.getByRole('button', { name: '查看校验报告' }).click()
  for (const n of ['core1', 'core2', 'core3']) await expect(reportStatus(page, n)).toHaveText('一致', { timeout: 120_000 })
  mark('verified')
  observed.report = await page.getByTestId('wizard-step-report').innerText()

  // Roll back core3 from the report.
  const rbStart = Date.now()
  await page.getByTestId('report-device').filter({ hasText: 'core3' }).getByRole('button', { name: '回滚这台…' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: '回滚' }).click()
  await expect(reportStatus(page, 'core3')).toHaveText('已回滚', { timeout: 300_000 })
  observed.rollbackMs = Date.now() - rbStart
  mark('rolledBack')

  const after = await json<{ members: { device_id: string }[] }>(req, 'GET', `/networks/${netId}/members`)
  expect(after.members.map((m) => m.device_id)).not.toContain(DEV.core3)
  const c3 = await instances(req, 'core3')
  expect(c3.running).toContain(officeOf('core3'))
  const toml = await nodeToml(req, 'core3', officeOf('core3'))
  observed.core3TomlAfterRollback = toml
  // The recreated instance ends with `[source] source = "webhook"`: the config-source marker web
  // v2.7.1 sets on instances it creates (a 2.6.4 core prints it as webhook). It is not config.
  observed.core3SourceTable = /^\[source\]/m.test(toml)
  expect(stripSourceTable(toml).split('\n')).toEqual(snapshot.instances[officeOf('core3')]!.toml!.split('\n'))
}
