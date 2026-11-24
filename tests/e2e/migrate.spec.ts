import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { migrateFixture, mockApi, type RecordedRequest } from './mockApi'
import { DEV, MIG, migrateMock, NET_ID, type MigrateMockOpts } from './migrateMock'

async function openWizard(page: Page, opts: MigrateMockOpts = {}) {
  const mock = migrateMock(opts)
  const api = await mockApi(page, mock.overrides)
  await page.goto('/#/migrate')
  await expect(page.getByRole('heading', { name: '迁移到中央网络' })).toBeVisible()
  return { ...api, state: mock.state }
}
const groupRow = (page: Page, name: string) => page.getByTestId('legacy-group').filter({ hasText: name })

async function toNetworkStep(page: Page) {
  await groupRow(page, 'office').getByRole('button', { name: '迁移这一组' }).click()
  await expect(page.getByTestId('wizard-step-network')).toBeVisible()
}

test.describe('banner and entry', () => {
  test('1: the overview banner counts running legacy instances, opens the wizard and can be dismissed', async ({ page }) => {
    const mock = migrateMock()
    await mockApi(page, mock.overrides)
    await page.goto('/#/')
    const banner = page.getByTestId('migration-banner')
    await expect(banner).toContainText('检测到 3 个旧版网络实例，可以迁移到中央网络')
    await banner.getByRole('link', { name: '开始迁移' }).click()
    await expect(page).toHaveURL(/#\/migrate$/)

    await page.goto('/#/')
    await page.getByTestId('migration-banner').getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('migration-banner')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: '概览' })).toBeVisible()
    await expect(page.getByTestId('migration-banner')).toHaveCount(0)

    // A new legacy instance id shows the banner again.
    mock.state.machines = () => {
      const data = migrateFixture('machines.json')
      const m = data.machines.find((x: { online: boolean; info?: { running_network_instances: unknown[] } }) => x.online && x.info)
      m.info.running_network_instances.push({ part1: 1, part2: 2, part3: 3, part4: 4 })
      return data
    }
    await page.reload()
    await expect(page.getByTestId('migration-banner')).toContainText('检测到 4 个旧版网络实例')
  })

  test('2: webhook mode has no banner and /migrate returns to the overview', async ({ page }) => {
    const { requests } = await mockApi(page, migrateMock().overrides, { webhook: true })
    await page.goto('/#/migrate')
    await expect(page).toHaveURL(/\/#\/$/)
    await expect(page.getByTestId('migration-banner')).toHaveCount(0)
    expect(requests.filter((r) => /\/machines\/[^/]+\/networks/.test(r.path))).toEqual([])
  })
})

test.describe('step 1: inventory', () => {
  test('3a: lists groups with instance, running and disabled counts and the target', async ({ page }) => {
    await openWizard(page)
    const office = groupRow(page, 'office')
    await expect(office).toContainText('4')
    await expect(office.getByTestId('count-running')).toHaveText('3')
    await expect(office.getByTestId('count-disabled')).toHaveText('1')
    await expect(office).toContainText('新建')
    const lab = groupRow(page, 'lab-old')
    await expect(lab.getByTestId('count-running')).toHaveText('0')
    await expect(lab.getByTestId('count-disabled')).toHaveText('1')
  })

  test('3b: an offline device is listed apart and its instances are not counted', async ({ page }) => {
    await openWizard(page, { offline: ['core4'] })
    await expect(groupRow(page, 'office').getByTestId('count-instances')).toHaveText('3')
    const offline = page.getByTestId('offline-devices')
    await expect(offline).toContainText('离线设备（1 台）')
    await expect(offline).toContainText('上线后才能读取它们的实例')
    await expect(offline).toContainText('core4')
  })

  test('3c: a failed read is listed with 重试; a retry that works adds its instances', async ({ page }) => {
    await openWizard(page, { failRead: ['core3'] })
    const failed = page.getByTestId('failed-devices')
    await expect(failed).toContainText('读取失败（1 台）')
    await expect(groupRow(page, 'office').getByTestId('count-instances')).toHaveText('3')
    await failed.getByRole('button', { name: '重试' }).click()
    await expect(failed).toHaveCount(0)
    await expect(groupRow(page, 'office').getByTestId('count-instances')).toHaveText('4')
  })
})

test.describe('step 2: network settings', () => {
  test('4: drafts from the most common values, lists conflicts, fills all servers, warns on a renamed network', async ({ page }) => {
    await openWizard(page)
    await toNetworkStep(page)
    const step = page.getByTestId('wizard-step-network')
    await expect(step.getByLabel('网络名')).toHaveValue('office')
    await expect(step.getByLabel('网段')).toHaveValue('10.150.0.0/24')
    const conflicts = step.getByTestId('draft-conflicts')
    await expect(conflicts).toContainText('tcp://core1:11010（2 台）')
    await expect(conflicts).toContainText('tcp://core2:11010（1 台）')
    await step.getByRole('button', { name: '使用全部服务器地址（2 个）' }).click()
    const peers = step.getByRole('group', { name: '节点地址' }).getByRole('textbox')
    await expect(peers).toHaveCount(2)
    await expect(peers.nth(0)).toHaveValue('tcp://core1:11010')
    await expect(peers.nth(1)).toHaveValue('tcp://core2:11010')

    await step.getByLabel('网络名').fill('office2')
    await expect(step).toContainText('迁移后的设备和还没迁移的设备将不在同一个虚拟网络里')
    await step.getByLabel('网络名').fill('')
    await expect(step.getByRole('button', { name: '下一步' })).toBeDisabled()
    await step.getByLabel('网络名').fill('office')
    await expect(step.getByRole('button', { name: '下一步' })).toBeEnabled()
  })

  test('5: an existing network named like the group is the target, read-only with a link to its settings', async ({ page }) => {
    await openWizard(page, { network: 'existing' })
    await expect(groupRow(page, 'office')).toContainText('已有网络 office')
    await toNetworkStep(page)
    const step = page.getByTestId('wizard-step-network')
    await expect(step).toContainText('将迁移到已有的中央网络 office')
    await expect(step.getByRole('link', { name: '到网络设置中修改' })).toHaveAttribute('href', `#/networks/${NET_ID}?tab=settings`)
    await expect(step.getByLabel('网络名')).toHaveCount(0)
  })

  test('6: steps 1 and 2 send no write request', async ({ page }) => {
    const { requests } = await openWizard(page)
    await toNetworkStep(page)
    await page.getByTestId('wizard-step-network').getByRole('button', { name: '使用全部服务器地址（2 个）' }).click()
    // metas and proxy-rpc show_node_info are POSTs that only read.
    const writes = requests.filter((r) => r.method !== 'GET' && !(r.method === 'POST' && (r.path.endsWith('/networks/metas') || r.path.endsWith('/proxy-rpc'))))
    expect(writes).toEqual([])
  })
})

async function toPreview(page: Page) {
  await toNetworkStep(page)
  await page.getByTestId('wizard-step-network').getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('wizard-step-preview')).toBeVisible()
}
const card = (page: Page, name: string) => page.getByTestId('device-preview').filter({ has: page.getByRole('heading', { name, exact: true }) })
const choice = (page: Page, name: string, label: '迁移' | '暂不迁移') => card(page, name).getByRole('radio', { name: label, exact: true })
/** The radios are visually hidden inside segmented-button labels; users click the label. */
const pick = (page: Page, name: string, label: '迁移' | '暂不迁移') =>
  card(page, name).getByRole('radiogroup', { name: `${name} 是否迁移` }).locator('label').filter({ hasText: new RegExp(`^${label}$`) }).click()
/** The 保留原地址 / 自动选择 switch of a device whose fixed IP conflicts. */
const pickIp = (page: Page, name: string, label: '保留原地址' | '自动选择') =>
  card(page, name).getByRole('radiogroup', { name: `${name} 的固定 IP` }).locator('label').filter({ hasText: new RegExp(`^${label}$`) }).click()

test.describe('step 3: preview', () => {
  test('7: running devices default to 迁移, the disabled one to 暂不迁移', async ({ page }) => {
    await openWizard(page)
    await toPreview(page)
    await expect(page.getByTestId('device-preview')).toHaveCount(4)
    for (const n of ['core1', 'core2', 'core3']) await expect(choice(page, n, '迁移')).toBeChecked()
    await expect(choice(page, 'core4', '暂不迁移')).toBeChecked()
    await expect(card(page, 'core4')).toContainText('这个实例已停用，暂不迁移时原样保留为手动实例')
  })

  test('8: core2 shows its member fields and override and has no changes', async ({ page }) => {
    await openWizard(page)
    await toPreview(page)
    const c = card(page, 'core2')
    await expect(c.getByTestId('member-fields')).toContainText('10.150.0.2')
    await expect(c.getByTestId('member-fields')).toContainText('core2-office')
    await expect(c.getByTestId('member-fields')).toContainText('192.168.88.0/24')
    await expect(c.getByTestId('override-fields')).toContainText('port_forwards')
    await expect(c.getByTestId('changes')).toHaveCount(0)
  })

  test('9: core3 ACL can be expanded; core1 has connectivity and VPN Portal changes', async ({ page }) => {
    await openWizard(page)
    await toPreview(page)
    const c3 = card(page, 'core3')
    await c3.getByRole('button', { name: '查看旧 ACL' }).click()
    await expect(c3.getByTestId('legacy-acl')).toContainText('3389')
    await expect(c3).toContainText('迁移不会转换 ACL')
    const c1 = card(page, 'core1')
    await expect(c1.getByTestId('changes')).toContainText('连接方式')
    await expect(c1.getByTestId('changes')).toContainText('VPN Portal')
  })

  test('10: 下一步 needs every change confirmed; the summary confirms a whole kind', async ({ page }) => {
    await openWizard(page)
    await toPreview(page)
    const next = page.getByTestId('wizard-step-preview').getByRole('button', { name: '下一步' })
    await expect(next).toBeDisabled()
    for (const box of await page.getByRole('checkbox', { name: '我已了解' }).all()) await box.check()
    await expect(next).toBeEnabled()
    await card(page, 'core3').getByRole('checkbox', { name: '我已了解' }).uncheck()
    await expect(next).toBeDisabled()
    await card(page, 'core3').getByRole('checkbox', { name: '我已了解' }).check()
    await card(page, 'core1').getByRole('checkbox', { name: '我已了解' }).first().uncheck()
    await expect(next).toBeDisabled()
    const summary = page.getByTestId('change-summary')
    await expect(summary).toContainText('连接方式 · 1 台')
    await summary.getByTestId('confirm-kind-connectivity').click()
    await expect(next).toBeEnabled()
  })

  test('11: a subnet the fixed IPs are outside of blocks those devices', async ({ page }) => {
    await openWizard(page)
    await toNetworkStep(page)
    await page.getByTestId('wizard-step-network').getByLabel('网段').fill('10.151.0.0/24')
    await page.getByTestId('wizard-step-network').getByRole('button', { name: '下一步' }).click()
    for (const n of ['core1', 'core2', 'core3']) {
      await expect(card(page, n)).toContainText('不在网段 10.151.0.0/24 内')
      await expect(choice(page, n, '迁移')).toBeDisabled()
    }
    await expect(page.getByTestId('change-summary')).toContainText('将迁移 0 台')
    await expect(page.getByTestId('wizard-step-preview').getByRole('button', { name: '下一步' })).toBeDisabled()
    // Outside the subnet is not switched by default; switching picks a free address in it.
    await pickIp(page, 'core1', '自动选择')
    await expect(card(page, 'core1').getByTestId('member-fields')).toContainText('10.150.0.1 → 10.151.0.1（自动选择）')
    await expect(choice(page, 'core1', '迁移')).toBeEnabled()
  })

  test('12: of two devices with one fixed IP the second auto-selects a free address; keeping it brings the conflict back', async ({ page }) => {
    await openWizard(page, { configs: { core3: { virtual_ipv4: '10.150.0.2' } } })
    await toPreview(page)
    // used: .1 core1, .2 core2 and core3, .4 core4 → .3
    await expect(card(page, 'core3').getByTestId('member-fields')).toContainText('10.150.0.2 → 10.150.0.3（自动选择）')
    await expect(card(page, 'core3').getByTestId('changes')).toContainText('固定 IP：10.150.0.2 → 10.150.0.3')
    await expect(card(page, 'core2')).not.toContainText('重复')
    await expect(choice(page, 'core3', '迁移')).toBeChecked()
    await pickIp(page, 'core3', '保留原地址')
    await expect(card(page, 'core2')).toContainText('固定 IP 10.150.0.2 和 core3 重复')
    await expect(card(page, 'core3')).toContainText('固定 IP 10.150.0.2 和 core2 重复')
    await pick(page, 'core3', '暂不迁移')
    await expect(choice(page, 'core3', '暂不迁移')).toBeChecked()
    await expect(card(page, 'core2')).not.toContainText('重复')
  })

  test('13: the preview fits a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openWizard(page)
    await toPreview(page)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(fits).toBe(true)
  })
})

async function toExecute(page: Page) {
  await toPreview(page)
  for (const box of await page.getByRole('checkbox', { name: '我已了解' }).all()) await box.check()
  await page.getByTestId('wizard-step-preview').getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('wizard-step-execute')).toBeVisible()
}
const execStep = (page: Page) => page.getByTestId('wizard-step-execute')
const execRow = (page: Page, name: string) => page.getByTestId('execute-device').filter({ hasText: name })
const reportRow = (page: Page, name: string) => page.getByTestId('report-device').filter({ hasText: name })
const reportStatus = (page: Page, name: string) => reportRow(page, name).getByTestId('report-status')
async function start(page: Page) {
  await execStep(page).getByLabel('我已经按升级手册备份了 et.db').check()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    execStep(page).getByRole('button', { name: '下载备份并开始迁移' }).click(),
  ])
  return download
}
const NAMES = ['core1', 'core2', 'core3'] as const
const inst = (n: (typeof NAMES)[number]) => MIG.instances[n]!.office!
/** Requests about one device: its id in the path or in the body. */
const about = (requests: RecordedRequest[], id: string) =>
  requests.filter((r) => r.path.includes(id) || JSON.stringify(r.body ?? '').includes(id)).map((r) => `${r.method} ${r.path}`)
function deferred() {
  let release!: () => void
  const until = new Promise<void>((r) => (release = r))
  return { until, release }
}

test.describe('step 4: execute', () => {
  test('14: the start button needs the backup box; starting downloads the export first', async ({ page }) => {
    await openWizard(page)
    await toExecute(page)
    const step = execStep(page)
    await expect(step).toContainText('将把 3 台设备迁移到中央网络 office。')
    await expect(step).toContainText('文件里有网络密钥，请妥善保存')
    await expect(step.getByRole('button', { name: '下载备份并开始迁移' })).toBeDisabled()
    const download = await start(page)
    expect(download.suggestedFilename()).toMatch(/^easytier-migration-office-\d{8}-\d{6}\.json$/)
    const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(data.format).toBe('easytier-console-migration/1')
    expect(data.devices.map((d: { device_name: string }) => d.device_name)).toEqual(['core1', 'core2', 'core3'])
  })

  test('15: creates the network from the draft, then runs every device in order', async ({ page }) => {
    const { requests } = await openWizard(page)
    await toExecute(page)
    const from = requests.length
    await start(page)
    for (const n of NAMES) await expect(execRow(page, n)).toContainText('已迁移')
    const after = requests.slice(from)
    const created = after.findIndex((r) => r.method === 'POST' && r.path === '/networks')
    expect(created).toBeGreaterThanOrEqual(0)
    expect(after[created]!.body).toEqual({
      settings: {
        display_name: 'office', network_name: 'office', networking_method: 'Manual', public_server_url: null,
        peer_urls: ['tcp://core1:11010'], virtual_cidr: '10.150.0.0/24', secure_mode: false,
      },
      network_secret: 'office-secret',
    })
    expect(after.findIndex((r) => r.method !== 'GET' && r.path.startsWith('/machines/'))).toBeGreaterThan(created)
    for (const n of NAMES) {
      const d = DEV[n]
      const i = inst(n)
      expect(about(after, d)).toEqual([
        `POST /machines/${d}/proxy-rpc`,
        `PUT /machines/${d}/networks/${i}`,
        `GET /machines/${d}/networks`,
        `GET /machines/${d}/networks/config/${i}`,
        `POST /networks/${NET_ID}/members`,
        `PATCH /networks/${NET_ID}/members/${d}`,
        `PUT /networks/${NET_ID}/members/${d}/config`,
        `DELETE /machines/${d}/networks/${i}`,
      ])
    }
    const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('et.migrate.admin') ?? '[]'))
    expect(journal.map((r: { deviceName: string; status: string }) => [r.deviceName, r.status])).toEqual([
      ['core1', 'migrated'], ['core2', 'migrated'], ['core3', 'migrated'],
    ])
    await expect(execStep(page).getByRole('button', { name: '查看校验报告' })).toBeVisible()
  })

  test('16: a failed join rolls that device back and the others go on', async ({ page }) => {
    const { requests, state } = await openWizard(page)
    state.failures.push({ method: 'POST', path: `/networks/${NET_ID}/members`, device: DEV.core3, status: 500, body: { message: 'boom' } })
    await toExecute(page)
    const from = requests.length
    await start(page)
    await expect(execRow(page, 'core3')).toContainText('已回滚（加入网络：boom）')
    await expect(execRow(page, 'core1')).toContainText('已迁移')
    await expect(execRow(page, 'core2')).toContainText('已迁移')
    const mine = requests.slice(from).filter((r) => r.path.includes(DEV.core3) || JSON.stringify(r.body ?? '').includes(DEV.core3))
    const last = mine[mine.length - 1]!
    expect(`${last.method} ${last.path}`).toBe(`PUT /machines/${DEV.core3}/networks/${inst('core3')}`)
    expect(last.body).toEqual({ disabled: false })
  })

  test('17: 停止 lets the current device finish and starts no other', async ({ page }) => {
    const { requests, state } = await openWizard(page)
    const hold = deferred()
    state.holds.push({ method: 'PUT', path: `/networks/${NET_ID}/members/${DEV.core1}/config`, until: hold.until })
    await toExecute(page)
    const from = requests.length
    await start(page)
    await expect(execRow(page, 'core1')).toContainText('写入设置')
    await execStep(page).getByRole('button', { name: '停止' }).click()
    hold.release()
    await expect(execRow(page, 'core1')).toContainText('已迁移')
    await expect(execRow(page, 'core2')).toContainText('等待中')
    await expect(execRow(page, 'core3')).toContainText('等待中')
    await expect(execStep(page).getByRole('button', { name: '查看校验报告' })).toBeVisible()
    expect(about(requests.slice(from), DEV.core2)).toEqual([])
  })

  test('18: leaving while it runs asks first; the current device still finishes', async ({ page }) => {
    const { requests, state } = await openWizard(page)
    const hold = deferred()
    state.holds.push({ method: 'PUT', path: `/networks/${NET_ID}/members/${DEV.core1}/config`, until: hold.until })
    await toExecute(page)
    const from = requests.length
    await start(page)
    await expect(execRow(page, 'core1')).toContainText('写入设置')
    const nav = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设备' })
    await nav.click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(dialog).toContainText('迁移正在进行。离开后，当前这台设备会做完（或回滚完），其余设备不再开始。')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(page).toHaveURL(/#\/migrate/)
    await nav.click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: '离开' }).click()
    await expect(page).toHaveURL(/#\/devices/)
    hold.release()
    await expect.poll(() => about(requests, DEV.core1)).toContain(`DELETE /machines/${DEV.core1}/networks/${inst('core1')}`)
    expect(about(requests.slice(from), DEV.core2)).toEqual([])
  })
})

async function runAll(page: Page) {
  await toExecute(page)
  await start(page)
  await expect(execStep(page).getByRole('button', { name: '查看校验报告' })).toBeVisible()
}

test.describe('step 5: report', () => {
  test('19: verifies each device; a mismatch can be rolled back and recreates the deleted legacy instance', async ({ page }) => {
    const { requests, state } = await openWizard(page)
    state.nodeToml.core1 = 'mtu = 1200'
    state.rpcDown = ['core3']
    await runAll(page)
    await execStep(page).getByRole('button', { name: '查看校验报告' }).click()
    const report = page.getByTestId('wizard-step-report')
    await expect(reportStatus(page, 'core2')).toHaveText('一致')
    await expect(reportStatus(page, 'core3')).toHaveText('等待上线后校验')
    await expect(reportStatus(page, 'core1')).toHaveText('不一致')
    await expect(reportRow(page, 'core1')).toContainText('mtu：期望 1380，实际 1200')
    await expect(report).toContainText('这些设备迁移前单独配置了 ACL：core3')
    await expect(report.getByRole('link', { name: '去写 ACL 规则' })).toHaveAttribute('href', `#/networks/${NET_ID}?tab=acl`)

    const from = requests.length
    await reportRow(page, 'core1').getByRole('button', { name: '回滚这台…' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.getByRole('button', { name: '回滚' }).click()
    await expect(reportStatus(page, 'core1')).toHaveText('已回滚')
    const writes = requests.slice(from).filter((r) => r.method !== 'GET')
    expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
      `DELETE /networks/${NET_ID}/members/${DEV.core1}`,
      `POST /machines/${DEV.core1}/networks`,
    ])
    expect(writes[1]!.body).toEqual({ config: migrateFixture('stored-core1-office.json'), save: true })
    const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('et.migrate.admin') ?? '[]'))
    expect(journal.find((r: { deviceName: string }) => r.deviceName === 'core1').status).toBe('rolledBack')
  })

  test('20: reopening the wizard offers the report; migrated devices are members and skipped', async ({ page }) => {
    const { state } = await openWizard(page)
    state.failures.push({ method: 'DELETE', path: '/machines/', status: 500, body: { message: 'boom' } })
    await runAll(page)
    await expect(execRow(page, 'core1')).toContainText('已迁移（旧实例没删掉：boom）')
    await page.goto('/#/')
    await page.goto('/#/migrate')
    await page.reload()
    await expect(page.getByRole('button', { name: '校验报告' })).toBeVisible()
    await expect(groupRow(page, 'office')).toContainText('已有网络 office')
    await toNetworkStep(page)
    await page.getByTestId('wizard-step-network').getByRole('button', { name: '下一步' }).click()
    for (const n of NAMES) await expect(card(page, n)).toContainText('已是成员，跳过')
  })

  test('21: 清除迁移记录… needs every device consistent or rolled back', async ({ page }) => {
    const { state } = await openWizard(page)
    state.rpcDown = ['core1', 'core2', 'core3']
    await runAll(page)
    await execStep(page).getByRole('button', { name: '查看校验报告' }).click()
    const report = page.getByTestId('wizard-step-report')
    for (const n of NAMES) await expect(reportStatus(page, n)).toHaveText('等待上线后校验')
    await expect(report).toContainText('文件里有网络密钥，请妥善保存')
    await expect(report.getByRole('button', { name: '清除迁移记录…' })).toBeDisabled()
    state.rpcDown = []
    await report.getByRole('button', { name: '重新校验' }).click()
    for (const n of NAMES) await expect(reportStatus(page, n)).toHaveText('一致')
    await report.getByRole('button', { name: '清除迁移记录…' }).click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: '清除' }).click()
    await expect(report.getByTestId('report-device')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('et.migrate.admin'))).toBeNull()
  })
})

const journalOf = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('et.migrate.admin') ?? '[]') as { deviceName: string; status: string; step?: string; rollbackStep?: string }[])

test.describe('final review: unfinished and failed devices are tracked', () => {
  test('22: a device being migrated has an inProgress record with its step, then migrated', async ({ page }) => {
    const { state } = await openWizard(page)
    const hold = deferred()
    state.holds.push({ method: 'PUT', path: `/networks/${NET_ID}/members/${DEV.core1}/config`, until: hold.until })
    await toExecute(page)
    await start(page)
    await expect(execRow(page, 'core1')).toContainText('写入设置')
    expect((await journalOf(page)).find((r) => r.deviceName === 'core1')).toMatchObject({ status: 'inProgress', step: 'settings' })
    hold.release()
    await expect(execRow(page, 'core1')).toContainText('已迁移')
    expect((await journalOf(page)).find((r) => r.deviceName === 'core1')!.status).toBe('migrated')
  })

  test('23: a failed rollback is kept as 需要处理 in the journal, the report and the banner; it blocks clearing', async ({ page }) => {
    const { state } = await openWizard(page)
    state.failures.push({ method: 'POST', path: `/networks/${NET_ID}/members`, device: DEV.core3, status: 500, body: { message: 'boom' } })
    state.failures.push({
      method: 'PUT', path: `/machines/${DEV.core3}/networks/${inst('core3')}`, bodyIncludes: '"disabled":false', status: 500, body: { message: 'enable failed' },
    })
    await toExecute(page)
    await start(page)
    await expect(execRow(page, 'core3')).toContainText('需要处理（加入网络：boom')
    await expect(execRow(page, 'core3')).toContainText('回滚停在「重新启用旧实例」')
    expect((await journalOf(page)).find((r) => r.deviceName === 'core3')).toMatchObject({ status: 'needsAttention', step: 'join', rollbackStep: 'enable' })
    await execStep(page).getByRole('button', { name: '查看校验报告' }).click()
    await expect(reportStatus(page, 'core3')).toContainText('需要处理')
    await expect(reportRow(page, 'core3').getByRole('button', { name: '回滚这台…' })).toBeVisible()
    await expect(page.getByTestId('wizard-step-report').getByRole('button', { name: '清除迁移记录…' })).toBeDisabled()
    await page.goto('/#/')
    await expect(page.getByTestId('migration-banner')).toContainText('1 台设备的迁移没有完成，需要处理')
  })

  test('24: a device left a member by a failed rollback says so in step 3 instead of suggesting to delete its legacy instance', async ({ page }) => {
    const { state } = await openWizard(page)
    state.failures.push({ method: 'PATCH', path: `/networks/${NET_ID}/members/${DEV.core2}`, status: 400, body: { message: 'bad' } })
    state.failures.push({ method: 'DELETE', path: `/networks/${NET_ID}/members/${DEV.core2}`, status: 500, body: { message: 'down' } })
    await runAll(page)
    await expect(execRow(page, 'core2')).toContainText('回滚停在「移出网络」')
    await page.goto('/#/')
    await page.goto('/#/migrate')
    await page.reload()
    await toNetworkStep(page)
    await page.getByTestId('wizard-step-network').getByRole('button', { name: '下一步' }).click()
    await expect(card(page, 'core2')).toContainText('上次迁移没有完成，请到校验报告处理')
    await expect(card(page, 'core2')).not.toContainText('可以在手动实例页删除')
  })

  test('25: 回滚这台… refuses while the device is offline and changes nothing', async ({ page }) => {
    const { requests, state } = await openWizard(page)
    await runAll(page)
    await execStep(page).getByRole('button', { name: '查看校验报告' }).click()
    await expect(reportStatus(page, 'core1')).toHaveText('一致')
    state.unreachable = ['core1']
    const from = requests.length
    await reportRow(page, 'core1').getByRole('button', { name: '回滚这台…' }).click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: '回滚' }).click()
    await expect(page.getByText('core1 离线，上线后再回滚')).toBeVisible()
    expect(requests.slice(from).filter((r) => r.method !== 'GET')).toEqual([])
    await expect(reportStatus(page, 'core1')).toHaveText('一致')
  })

  test('26: a single-device rollback that fails after removing the member is kept as 需要处理', async ({ page }) => {
    const { state } = await openWizard(page)
    await runAll(page)
    await execStep(page).getByRole('button', { name: '查看校验报告' }).click()
    await expect(reportStatus(page, 'core1')).toHaveText('一致')
    state.failures.push({ method: 'POST', path: `/machines/${DEV.core1}/networks`, status: 500, body: { message: 'nope' } })
    await reportRow(page, 'core1').getByRole('button', { name: '回滚这台…' }).click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: '回滚' }).click()
    await expect(reportStatus(page, 'core1')).toContainText('需要处理')
    expect((await journalOf(page)).find((r) => r.deviceName === 'core1')!.status).toBe('needsAttention')
  })
})

test.describe('auto-selected addresses', () => {
  test('27: the run gives the device the address shown in step 3', async ({ page }) => {
    const { requests } = await openWizard(page, { configs: { core3: { virtual_ipv4: '10.150.0.2' } } })
    await toExecute(page)
    const from = requests.length
    await start(page)
    await expect(execRow(page, 'core3')).toContainText('已迁移')
    const patch = requests.slice(from).find((r) => r.method === 'PATCH' && r.path === `/networks/${NET_ID}/members/${DEV.core3}`)
    expect(patch?.body).toMatchObject({ virtual_ipv4: '10.150.0.3' })
  })
})

test.describe('manual routes (routes = [] on a 2.6.4 core)', () => {
  test('28: the mode read from the running TOML shows in the override and is sent to the member', async ({ page }) => {
    const mock = migrateMock()
    mock.state.nodeToml.core1 = 'hostname = "core1"\ninstance_id = "x"\nroutes = []\n\n[network_identity]\nnetwork_name = "office"\n'
    const { requests } = await mockApi(page, mock.overrides)
    await page.goto('/#/migrate')
    await toPreview(page)
    await expect(card(page, 'core1').getByTestId('override-fields')).toContainText('enable_manual_routes = true')
    await expect(card(page, 'core2').getByTestId('override-fields')).not.toContainText('enable_manual_routes')
    for (const box of await page.getByRole('checkbox', { name: '我已了解' }).all()) await box.check()
    await page.getByTestId('wizard-step-preview').getByRole('button', { name: '下一步' }).click()
    const from = requests.length
    await start(page)
    await expect(execRow(page, 'core1')).toContainText('已迁移')
    const put = requests.slice(from).find((r) => r.method === 'PUT' && r.path === `/networks/${NET_ID}/members/${DEV.core1}/config`)
    expect((put?.body as { config: Record<string, unknown> }).config).toMatchObject({ enable_manual_routes: true })
  })
})
