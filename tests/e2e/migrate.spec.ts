import { expect, test, type Page } from '@playwright/test'
import { migrateFixture, mockApi } from './mockApi'
import { migrateMock, NET_ID, type MigrateMockOpts } from './migrateMock'

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
    const writes = requests.filter((r) => r.method !== 'GET' && !(r.method === 'POST' && r.path.endsWith('/networks/metas')))
    expect(writes).toEqual([])
  })
})
