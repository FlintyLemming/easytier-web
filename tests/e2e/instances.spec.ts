import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Request } from '@playwright/test'
import { uuidToStr } from '../../src/lib/uuid'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const CORE2 = '22222222-2222-4222-8222-222222222222'
/** The manual instance on core2 in the Task 1 fixtures (`lab-manual`, 10.88.0.3/24). */
const INST = '5eed0000-0000-4000-8000-000000000001'
/** core2 also runs the central network's instance, whose id is the network id. */
const CENTRAL = fixture('networks.json').networks[0].network_id as string
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LEGACY = ['enable_vpn_portal', 'vpn_portal_listen_port', 'vpn_portal_client_network_addr', 'vpn_portal_client_network_len']
const LEGACY_NOTE = '# 注意：旧版 VPN Portal 设置（enable_vpn_portal 等）无法导出为 TOML，未包含在此文件中。'

/** core2's instance endpoints as captured in Task 1; `state.disabled` moves lab-manual to the disabled list. */
function instanceApi(state = { disabled: false }): Overrides {
  return {
    [`GET /machines/${CORE2}/networks`]: () => {
      const list = fixture('instances-core2.json')
      if (state.disabled) {
        const mine = (u: object) => uuidToStr(u) === INST
        list.disabled_inst_ids.push(...list.running_inst_ids.filter(mine))
        list.running_inst_ids = list.running_inst_ids.filter((u: object) => !mine(u))
      }
      return list
    },
    [`POST /machines/${CORE2}/networks/metas`]: () => fixture('instance-metas-core2.json'),
    [`GET /machines/${CORE2}/networks/info/*`]: () => fixture('instance-info-core2.json'),
    [`GET /machines/${CORE2}/networks/config/*`]: () => fixture('instance-config-core2.json'),
    'POST /generate-config': () => fixture('generate-config-ok.json'),
    'POST /parse-config': () => fixture('parse-config-ok.json'),
  }
}

async function openInstances(page: Page, overrides: Overrides = {}) {
  const ctx = await mockApi(page, { ...instanceApi(), ...overrides })
  await page.goto(`/#/devices/${CORE2}/instances`)
  return ctx
}

const labRow = (page: Page) => page.getByTestId('instance-row').filter({ hasText: 'lab-manual' })

async function rowAction(page: Page, item: string) {
  await labRow(page).getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

const configWrites = (reqs: RecordedRequest[]) =>
  reqs.filter((r) => r.method === 'PUT' && r.path.startsWith(`/machines/${CORE2}/networks/config/`))
const runs = (reqs: RecordedRequest[]) => reqs.filter((r) => r.method === 'POST' && r.path === `/machines/${CORE2}/networks`)
type Write = { config: Record<string, unknown>; save?: boolean }

test('1: the switcher leads to the manual instances; central-network instances are not listed', async ({ page }) => {
  await mockApi(page, instanceApi())
  await page.goto(`/#/devices/${CORE2}`)
  await page.getByRole('button', { name: /切换网络/ }).click()
  await page.getByRole('menuitem', { name: '手动实例（高级）…' }).click()
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE2}/instances$`))
  await expect(page.getByRole('navigation', { name: '面包屑' })).toHaveText(/^\s*设备\s*\/\s*core2\s*\/\s*手动实例\s*$/)
  await expect(page.getByRole('heading', { level: 1, name: '手动实例' })).toBeVisible()
  await expect(page.getByText('直接运行在这台设备上的网络实例，不受中央网络管理。')).toBeVisible()

  const rows = page.getByTestId('instance-row')
  await expect(rows).toHaveCount(1)
  await expect(labRow(page)).toContainText(INST)
  await expect(labRow(page)).toContainText('运行中')
  await expect(labRow(page)).toContainText('10.88.0.3/24')
  await expect(page.getByText(CENTRAL)).toHaveCount(0)
  await expect(page.getByText('home-central')).toHaveCount(0)
  // 新建实例 is the page's single orange button (the shell's 添加设备 aside).
  await expect(page.getByRole('button', { name: '新建实例' })).toHaveClass(/bg-primary/)
  await expect(page.getByRole('main').locator('button.bg-primary')).toHaveCount(1)
})

test('2: 停用 PUTs { disabled: true }; the row then reads 已停用 and offers 启用', async ({ page }) => {
  const state = { disabled: false }
  const { requests } = await openInstances(page, {
    ...instanceApi(state),
    [`PUT /machines/${CORE2}/networks/${INST}`]: (req: Request) => {
      state.disabled = (req.postDataJSON() as { disabled: boolean }).disabled
      return {}
    },
  })
  await expect(labRow(page)).toContainText('运行中')
  await rowAction(page, '停用')
  await expect
    .poll(() => requests.find((r) => r.method === 'PUT' && r.path === `/machines/${CORE2}/networks/${INST}`)?.body)
    .toEqual({ disabled: true })
  await expect(labRow(page)).toContainText('已停用')
  await expect(labRow(page)).not.toContainText('10.88.0.3')
  await labRow(page).getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('menuitem', { name: '启用', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '停用', exact: true })).toHaveCount(0)
})

test('3: 编辑 → MTU 1300 → 保存 reruns the instance under its id with every other field as read', async ({ page }) => {
  const { requests } = await openInstances(page)
  await rowAction(page, '编辑')
  const dlg = page.getByRole('dialog', { name: '编辑 lab-manual' })
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('保存后实例会用新配置重新启动。')
  await dlg.getByLabel('MTU', { exact: true }).fill('1300')
  await dlg.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByText('已保存 lab-manual')).toBeVisible()

  expect(runs(requests)).toHaveLength(1)
  expect(configWrites(requests)).toEqual([])
  const body = runs(requests)[0]!.body as Write
  expect(body.save).toBe(true)
  expect(body.config.instance_id).toBe(INST)
  expect(body.config.mtu).toBe(1300)
  const read = fixture('instance-config-core2.json')
  // The fixture has no vpn_portal_config; its legacy VPN portal fields must survive instead (R4).
  for (const key of ['routes', 'exit_nodes', 'acl', 'port_forwards', 'dns', 'mapped_listeners', ...LEGACY]) {
    expect(body.config[key], key).toEqual(read[key])
  }
})

test('3b: editing a disabled instance saves its config without starting it', async ({ page }) => {
  const { requests } = await openInstances(page, instanceApi({ disabled: true }))
  await expect(labRow(page)).toContainText('已停用')
  await rowAction(page, '编辑')
  const dlg = page.getByRole('dialog', { name: '编辑 lab-manual' })
  await expect(dlg.getByLabel('MTU', { exact: true })).toHaveValue('1380')
  await expect(dlg).not.toContainText('保存后实例会用新配置重新启动。')
  await dlg.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dlg).toHaveCount(0)
  expect(runs(requests)).toEqual([])
  const writes = configWrites(requests)
  expect(writes.map((w) => w.path)).toEqual([`/machines/${CORE2}/networks/config/${INST}`])
  expect((writes[0]!.body as Write).config.instance_id).toBe(INST)
})

test('4: 新建实例 → 仅保存 PUTs the config under a fresh uuid', async ({ page }) => {
  const { requests } = await openInstances(page)
  await expect(labRow(page)).toBeVisible()
  await page.getByRole('button', { name: '新建实例' }).click()
  const dlg = page.getByRole('dialog', { name: '新建实例' })
  await dlg.getByLabel('网络名', { exact: true }).fill('new-one')
  await dlg.getByRole('button', { name: '仅保存' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByText('已创建 new-one')).toBeVisible()

  const writes = configWrites(requests)
  expect(writes).toHaveLength(1)
  const id = writes[0]!.path.split('/').pop()!
  expect(id).toMatch(UUID_V4)
  const config = (writes[0]!.body as Write).config
  expect(config.network_name).toBe('new-one')
  expect(config.instance_id).toBe(id)
  expect(runs(requests)).toEqual([])
})

test('4b: 创建并运行 POSTs with save; a failure toasts and keeps the dialog open', async ({ page }) => {
  let fail = true
  const { requests } = await openInstances(page, {
    [`POST /machines/${CORE2}/networks`]: () => (fail ? status(500, { message: 'core refused' }) : {}),
  })
  await page.getByRole('button', { name: '新建实例' }).click()
  const dlg = page.getByRole('dialog', { name: '新建实例' })
  await dlg.getByLabel('网络名', { exact: true }).fill('run-one')
  await dlg.getByRole('button', { name: '创建并运行' }).click()
  await expect(page.getByText('操作失败：core refused')).toBeVisible()
  await expect(dlg).toBeVisible()
  await expect(dlg.getByLabel('网络名', { exact: true })).toHaveValue('run-one')

  fail = false
  await dlg.getByRole('button', { name: '创建并运行' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByText('已创建 run-one')).toBeVisible()
  const sent = runs(requests).map((r) => r.body as Write)
  expect(sent).toHaveLength(2)
  expect(sent[1]!.save).toBe(true)
  expect(sent[1]!.config.network_name).toBe('run-one')
  expect(sent[1]!.config.instance_id).toMatch(UUID_V4)
  expect(sent[1]!.config.instance_id).toBe(sent[0]!.config.instance_id)
})

test('5: 导入 TOML opens the editor with the parsed config under a new id; a parse error toasts', async ({ page }) => {
  let parsed: unknown = fixture('parse-config-ok.json')
  const { requests } = await openInstances(page, { 'POST /parse-config': () => parsed })
  await expect(labRow(page)).toBeVisible()
  const input = page.locator('input[type="file"]')
  await expect(input).toHaveAttribute('accept', '.toml,text/plain')
  const file = { name: 'lab.toml', mimeType: 'text/plain', buffer: Buffer.from('network_name = "lab-manual"\n') }

  await input.setInputFiles(file)
  const dlg = page.getByRole('dialog', { name: '新建实例' })
  await expect(dlg.getByLabel('网络名', { exact: true })).toHaveValue('lab-manual')
  expect(requests.find((r) => r.path === '/parse-config')?.body).toEqual({ toml_config: 'network_name = "lab-manual"\n' })
  // The input is cleared so the same file can be picked again.
  await expect.poll(() => input.inputValue()).toBe('')
  await dlg.getByRole('button', { name: '仅保存' }).click()
  await expect(dlg).toHaveCount(0)
  const writes = configWrites(requests)
  expect(writes).toHaveLength(1)
  const config = (writes[0]!.body as Write).config
  expect(config.network_name).toBe('lab-manual')
  expect(config.instance_id).toMatch(UUID_V4)
  expect(config.instance_id).not.toBe(INST)
  expect(writes[0]!.path).toBe(`/machines/${CORE2}/networks/config/${config.instance_id}`)

  parsed = fixture('parse-config-error.json')
  await input.setInputFiles(file)
  await expect(page.getByText(/^无法解析 TOML：/)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => input.inputValue()).toBe('')
})

test('6: 导出 TOML downloads lab-manual.toml, without the id or the legacy VPN fields', async ({ page }) => {
  const { requests } = await openInstances(page)
  await labRow(page).getByRole('button', { name: '更多操作' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出 TOML' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('lab-manual.toml')
  // generate-config rejects the legacy fields, so they are left out and the file says so (R4).
  const toml = fixture('generate-config-ok.json').toml_config as string
  expect(readFileSync(await file.path(), 'utf8')).toBe(`${LEGACY_NOTE}\n${toml}`)

  const sent = (requests.find((r) => r.path === '/generate-config')!.body as Write).config
  expect(sent.network_name).toBe('lab-manual')
  expect(sent.mtu).toBe(1380)
  expect(sent.instance_id).toBeUndefined()
  for (const key of LEGACY) expect(sent[key], key).toBeUndefined()
})

test('6b: generate-config answering with an error toasts 导出失败', async ({ page }) => {
  await openInstances(page, { 'POST /generate-config': () => ({ error: 'unsupported field', toml_config: null }) })
  let downloaded = false
  page.on('download', () => { downloaded = true })
  await rowAction(page, '导出 TOML')
  await expect(page.getByText('导出失败：unsupported field')).toBeVisible()
  expect(downloaded).toBe(false)
})

test('7: 删除… confirms, then DELETEs the instance', async ({ page }) => {
  const { requests } = await openInstances(page)
  const deletes = () => requests.filter((r) => r.method === 'DELETE')
  await rowAction(page, '删除…')
  let dlg = page.getByRole('dialog', { name: '删除实例' })
  await expect(dlg).toContainText('将停止并删除 lab-manual，设备上的这个实例无法恢复。')
  await dlg.getByRole('button', { name: '取消' }).click()
  await expect(dlg).toHaveCount(0)
  expect(deletes()).toEqual([])

  await rowAction(page, '删除…')
  dlg = page.getByRole('dialog', { name: '删除实例' })
  await dlg.getByRole('button', { name: '删除', exact: true }).click()
  await expect.poll(() => deletes().map((r) => r.path)).toEqual([`/machines/${CORE2}/networks/${INST}`])
  await expect(page.getByText('已删除 lab-manual')).toBeVisible()
})

test('8: an offline device shows 设备离线 and sends no instance requests', async ({ page }) => {
  await page.clock.install()
  const { requests } = await openInstances(page, {
    'GET /machines': () => {
      const base = fixture('machines.json')
      for (const m of base.machines) if (m.info.hostname === 'core2') m.online = false
      return base
    },
  })
  await expect(page.getByText('设备离线，恢复连接后可以管理实例')).toBeVisible()
  const machinePolls = () => requests.filter((r) => r.method === 'GET' && r.path === '/machines').length
  const before = machinePolls()
  await page.clock.runFor(20_000)
  await expect.poll(machinePolls).toBeGreaterThan(before)
  await expect(page.getByText('设备离线，恢复连接后可以管理实例')).toBeVisible()
  expect(requests.filter((r) => r.path.startsWith(`/machines/${CORE2}/networks`))).toEqual([])
  await expect(page.getByRole('button', { name: '新建实例' })).toHaveCount(0)
})

test('9: a failing first read shows 读取实例失败 and 重试', async ({ page }) => {
  let fail = true
  await openInstances(page, {
    [`GET /machines/${CORE2}/networks`]: () => (fail ? status(500, { message: 'instance store down' }) : fixture('instances-core2.json')),
  })
  await expect(page.getByText('读取实例失败')).toBeVisible()
  await expect(page.getByText('instance store down')).toBeVisible()
  fail = false
  await page.getByRole('button', { name: '重试' }).click()
  await expect(labRow(page)).toContainText('运行中')
  await expect(page.getByText('读取实例失败')).toHaveCount(0)
})

test('9b: a failing refresh keeps the rows and says 刷新失败，正在重试', async ({ page }) => {
  await page.clock.install()
  let fail = false
  await openInstances(page, {
    [`GET /machines/${CORE2}/networks`]: () => (fail ? status(500, { message: 'flaky' }) : fixture('instances-core2.json')),
  })
  await expect(labRow(page)).toContainText('运行中')
  fail = true
  await page.clock.runFor(6_000)
  await expect(page.getByText('刷新失败，正在重试')).toBeVisible()
  await expect(labRow(page)).toContainText('运行中')
  fail = false
  await page.clock.runFor(6_000)
  await expect(page.getByText('刷新失败，正在重试')).toHaveCount(0)
})

test('10: webhook mode: the device detail shows the instances panel beside the overview', async ({ page }) => {
  const { requests } = await mockApi(page, instanceApi(), { webhook: true })
  await page.goto(`/#/devices/${CORE2}`)
  const panel = page.getByTestId('instances-panel')
  await expect(panel.getByTestId('instance-row').filter({ hasText: 'lab-manual' })).toContainText('运行中')
  // Webhook mode has no central networks, so nothing is excluded.
  await expect(panel.getByTestId('instance-row')).toHaveCount(2)
  await expect(page.getByTestId('overview-card')).toContainText(CORE2)
  await expect(page.getByRole('button', { name: '新建实例' })).toBeEnabled()
  expect(requests.filter((r) => r.path.startsWith('/networks'))).toEqual([])
})

test('11: at 390px the rows become cards and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await openInstances(page)
  const card = page.getByTestId('instance-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('lab-manual')
  await expect(card).toContainText('运行中')
  await expect(card).toContainText('10.88.0.3/24')
  await expect(page.getByTestId('instance-row')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('12: a device in no network links to its manual instances', async ({ page }) => {
  await mockApi(page, {
    ...instanceApi(),
    'GET /machines': () => {
      const base = fixture('machines.json')
      for (const m of base.machines) if (m.info.hostname === 'core2') m.networks = []
      return base
    },
  })
  await page.goto(`/#/devices/${CORE2}`)
  await expect(page.getByText('还没加入网络')).toBeVisible()
  await page.getByRole('link', { name: '手动实例（高级）' }).click()
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE2}/instances$`))
  await expect(labRow(page)).toBeVisible()
})

test('13: no manual instances: the empty state, with 新建实例 still available', async ({ page }) => {
  await openInstances(page, {
    [`GET /machines/${CORE2}/networks`]: () => ({ running_inst_ids: fixture('instances-core2.json').running_inst_ids.filter((u: object) => uuidToStr(u) === CENTRAL), disabled_inst_ids: [] }),
  })
  await expect(page.getByText('这台设备上没有手动实例')).toBeVisible()
  await expect(page.getByTestId('instance-row')).toHaveCount(0)
  await page.getByRole('button', { name: '新建实例' }).click()
  await expect(page.getByRole('dialog', { name: '新建实例' })).toBeVisible()
})

test('14: a device-local, read-only, undeletable instance in error', async ({ page }) => {
  await openInstances(page, {
    [`POST /machines/${CORE2}/networks/metas`]: () => {
      const metas = fixture('instance-metas-core2.json')
      metas.metas[INST].source = 'ConfigSourceUser'
      metas.metas[INST].config_permission = 3
      return metas
    },
    [`GET /machines/${CORE2}/networks/info/*`]: () => ({ info: { map: { [INST]: { running: false, error_msg: 'tun device busy' } } } }),
  })
  await expect(labRow(page)).toContainText('设备本地配置')
  await expect(labRow(page)).toContainText('错误：tun device busy')
  await labRow(page).getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['停用', '导出 TOML'])
})

test('15: an unknown device shows the not-found state', async ({ page }) => {
  await mockApi(page, instanceApi())
  await page.goto('/#/devices/99999999-9999-4999-8999-999999999999/instances')
  await expect(page.getByText('找不到这台设备')).toBeVisible()
})
