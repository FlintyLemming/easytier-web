import { expect, test, type Page, type Request } from '@playwright/test'
import { fixture, mockApi, status, type Overrides, type RecordedRequest } from './mockApi'

const CORE1 = '11111111-1111-4111-8111-111111111111'
const CORE2 = '22222222-2222-4222-8222-222222222222'
const CORE3 = '33333333-3333-4333-8333-333333333333'
const NEW_ID = '44444444-4444-4444-8444-444444444444'
const NET = fixture('networks.json').networks[0].network_id as string
const OFFICE = '55555555-5555-4555-8555-555555555555'

const RPC: Record<string, string> = {
  list_route: 'list-route-core1.json',
  list_peer: 'list-peer-core1.json',
  show_node_info: 'show-node-info-core3.json',
  get_logger_config: 'logger-level.json',
}

function machines(patch?: (m: any) => void, extra: object[] = []) {
  const base = fixture('machines.json')
  if (patch) base.machines.forEach(patch)
  base.machines.push(...extra)
  return base
}

function members(patch: (m: any) => void) {
  const base = fixture('members.json')
  base.members.forEach(patch)
  return base
}

const rpcCalls = (reqs: RecordedRequest[], method?: string) =>
  reqs.filter(
    (r) =>
      r.method === 'POST' &&
      r.path.includes('/proxy-rpc') &&
      (method === undefined || (r.body as { method_name?: string })?.method_name === method),
  )

async function open(page: Page, id: string, overrides: Overrides = {}, network?: string) {
  const ctx = await mockApi(page, overrides)
  await page.goto(network ? `/#/devices/${id}/networks/${network}` : `/#/devices/${id}`)
  return ctx
}

test('1: list → core1 opens default network directly, no network/instance chooser', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/devices')
  await page.getByRole('row').filter({ hasText: 'core1' }).getByText('Alpine Linux').click()
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE1}$`))
  await expect(page.getByRole('navigation', { name: '面包屑' })).toHaveText(/^\s*设备\s*\/\s*core1\s*$/)
  const table = page.getByRole('table', { name: '连接' })
  await expect(table.getByRole('row').filter({ hasText: 'core2' })).toBeVisible()
  await expect(page.getByText(/选择网络|选择实例/)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'core1' })).toBeVisible()
})

test('2: network switcher marks default and joins another network', async ({ page }) => {
  const { requests } = await open(page, CORE1, {
    'GET /networks': () => {
      const n = fixture('networks.json')
      n.networks.push({
        network_id: OFFICE,
        display_name: 'office',
        network_name: 'office',
        networking_method: 'Manual',
        virtual_cidr: '10.155.0.0/24',
        secure_mode: false,
        member_count: 0,
        online_member_count: 0,
      })
      return n
    },
    [`GET /networks/${OFFICE}/members`]: () => ({ members: [], temporary_peers: [] }),
  })
  await page.getByRole('button', { name: /切换网络/ }).click()
  const def = page.getByRole('menuitem', { name: /home-central/ })
  await expect(def).toContainText('默认 ✓')
  await page.getByRole('menuitem', { name: '加入其他网络…' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('radio', { name: /home-central/ })).toHaveCount(0)
  await dlg.getByRole('radio', { name: /office/ }).check()
  await dlg.getByRole('button', { name: '加入', exact: true }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'POST' && r.path === `/networks/${OFFICE}/members`)?.body)
    .toEqual({ device_ids: [CORE1], temporary: false })
  await expect(page).toHaveURL(new RegExp(`/#/devices/${CORE1}/networks/${OFFICE}$`))
})

test('2b: switcher shows join disabled when the device is in every network', async ({ page }) => {
  await open(page, CORE1)
  await page.getByRole('button', { name: /切换网络/ }).click()
  const join = page.getByRole('menuitem', { name: /加入其他网络…/ })
  await expect(join).toHaveAttribute('aria-disabled', 'true')
  await expect(join).toContainText('已在所有网络中')
})

test('3: connections table lists core2 and core3 with mode labels', async ({ page }) => {
  await open(page, CORE1)
  const table = page.getByRole('table', { name: '连接' })
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'core2' })).toContainText('10.144.144.2')
  await expect(rows.filter({ hasText: 'core3' })).toContainText('10.144.144.3')
  for (const mode of await table.getByTestId('link-mode').allTextContents()) {
    expect(mode.trim()).toMatch(/^(P2P · |中继 · 经 )/)
  }
  await expect(page.getByText('2 个直连 · 0 个中继 · 每 15 秒刷新')).toBeVisible()
})

test('4a: 设为固定 sends exactly { virtual_ipv4 }', async ({ page }) => {
  const { requests } = await open(page, CORE1, {
    'GET /networks/*/members': () =>
      members((m) => {
        if (m.device_id === CORE1) { m.virtual_ipv4 = null; m.allocated_ipv4 = '10.144.144.1' }
      }),
  })
  const row = page.getByTestId('setting-ip')
  await expect(row).toContainText('自动分配 · 10.144.144.1')
  await row.getByRole('button', { name: '设为固定' }).click()
  await row.getByRole('textbox').fill('10.144.144.9')
  await row.getByRole('button', { name: '保存' }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'PATCH' && r.path === `/networks/${NET}/members/${CORE1}`)?.body)
    .toEqual({ virtual_ipv4: '10.144.144.9' })
})

test('4b: 改回自动 sends { virtual_ipv4: "" }, hostname override sends exactly { hostname_override }', async ({ page }) => {
  const { requests } = await open(page, CORE1)
  const patches = () => requests.filter((r) => r.method === 'PATCH' && r.path === `/networks/${NET}/members/${CORE1}`)
  const ipRow = page.getByTestId('setting-ip')
  await expect(ipRow).toContainText('固定 · 10.144.144.1')
  await ipRow.getByRole('button', { name: '改回自动' }).click()
  await expect.poll(() => patches().map((r) => r.body)).toEqual([{ virtual_ipv4: '' }])

  const hostRow = page.getByTestId('setting-hostname')
  await expect(hostRow).toContainText('未设置')
  await hostRow.getByRole('button', { name: '编辑' }).click()
  await hostRow.getByRole('textbox').fill('nas')
  await hostRow.getByRole('button', { name: '保存' }).click()
  await expect.poll(() => patches().map((r) => r.body)).toEqual([{ virtual_ipv4: '' }, { hostname_override: 'nas' }])
})

test('4c: clearing a hostname override sends { hostname_override: "" }', async ({ page }) => {
  const { requests } = await open(page, CORE3)
  const hostRow = page.getByTestId('setting-hostname')
  await expect(hostRow).toContainText('lab-box')
  await hostRow.getByRole('button', { name: '清除' }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'PATCH' && r.path === `/networks/${NET}/members/${CORE3}`)?.body)
    .toEqual({ hostname_override: '' })
})

test('5: subnet proxy offers /24 candidates from interface IPs and PATCHes exactly { proxy_cidrs }', async ({ page }) => {
  const { requests } = await open(page, CORE1)
  const row = page.getByTestId('setting-proxy')
  await row.getByRole('button', { name: '编辑' }).click()
  const cand = row.getByRole('button', { name: /192\.168\.97\.0\/24/ })
  await expect(cand).toBeVisible()
  await cand.click()
  await row.getByRole('textbox').fill('10.9.0.0/33')
  await row.getByRole('button', { name: '添加', exact: true }).click()
  await expect(row.getByText('请输入 IPv4 网段，例如 192.168.1.0/24')).toBeVisible()
  await row.getByRole('textbox').fill('10.9.0.0/16')
  await row.getByRole('button', { name: '添加', exact: true }).click()
  await row.getByRole('button', { name: '移除 10.9.0.0/16' }).click()
  await row.getByRole('button', { name: '保存' }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'PATCH' && r.path === `/networks/${NET}/members/${CORE1}`)?.body)
    .toEqual({ proxy_cidrs: ['192.168.97.0/24'] })
})

test('6: 恢复默认 on core3 keeps subnet proxies via PUT, not DELETE', async ({ page }) => {
  const { requests } = await open(page, CORE3)
  const row = page.getByTestId('setting-advanced')
  await expect(row).toContainText('默认')
  await row.getByRole('button', { name: '恢复默认' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toContainText('子网代理会保留')
  await dlg.getByRole('button', { name: '恢复默认' }).click()
  const cfgPath = `/networks/${NET}/members/${CORE3}/config`
  await expect
    .poll(() => requests.find((r) => r.method === 'PUT' && r.path === cfgPath)?.body)
    .toEqual({ config: { proxy_cidrs: ['192.168.77.0/24'] } })
  expect(requests.some((r) => r.method === 'DELETE' && r.path === cfgPath)).toBe(false)
})

test('6b: overridden config shows 已覆盖', async ({ page }) => {
  await open(page, CORE3, { 'GET /networks/*/members/*/config': () => ({ proxy_cidrs: ['192.168.77.0/24'], mtu: 1300 }) })
  await expect(page.getByTestId('setting-advanced')).toContainText('已覆盖')
})

test('7: diagnostics: collapsed, logger level, ACL stats, copyable TOML', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { requests } = await open(page, CORE3, {
    'POST /machines/*/proxy-rpc': (req: Request) => {
      const name = (req.postDataJSON() as { method_name: string }).method_name
      if (name === 'get_acl_stats') {
        return { acl_stats: { rules: [{ rule: { name: 'r1:tcp' }, stat: { packet_count: '12', byte_count: '2048' } }] } }
      }
      return RPC[name] ? fixture(RPC[name]) : {}
    },
  })
  const toggle = page.getByRole('button', { name: '诊断' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('日志级别')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const select = page.getByLabel('日志级别')
  await expect(select).toHaveValue('0')
  await select.selectOption('4')
  await expect
    .poll(() => rpcCalls(requests, 'set_logger_config').map((r) => (r.body as any).payload))
    .toEqual([{ level: 4 }])
  const acl = page.getByRole('table', { name: 'ACL 规则命中' })
  await expect(acl.getByRole('row').filter({ hasText: 'r1:tcp' })).toContainText('12')
  await expect(acl.getByRole('row').filter({ hasText: 'r1:tcp' })).toContainText('2 KB')
  await expect(page.getByTestId('running-toml')).toContainText('instance_name = "home-central"')
  await page.getByRole('button', { name: '复制 TOML' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('instance_name = "home-central"')
})

test('8a: 移出此网络 confirms then DELETEs the member', async ({ page }) => {
  const { requests } = await open(page, CORE1)
  await page.getByRole('button', { name: '移出此网络' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: '移出', exact: true }).click()
  await expect
    .poll(() => requests.some((r) => r.method === 'DELETE' && r.path === `/networks/${NET}/members/${CORE1}`))
    .toBe(true)
})

test('8b: 删除设备… confirms then returns to the list', async ({ page }) => {
  const { requests } = await open(page, CORE1)
  await page.getByRole('button', { name: '删除设备…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect.poll(() => requests.some((r) => r.method === 'DELETE' && r.path === `/machines/${CORE1}`)).toBe(true)
  await expect(page).toHaveURL(/\/#\/devices$/)
})

test('8c: header ⋯ menu offers copy ID and delete', async ({ page }) => {
  await open(page, CORE1)
  await page.getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['复制设备 ID', '删除设备…'])
  await page.getByRole('menuitem', { name: '删除设备…' }).click()
  await expect(page.getByRole('dialog')).toContainText('删除设备')
})

test('9: device in no network shows NotInNetworkState with 加入 home-central', async ({ page }) => {
  const extra = {
    client_url: 'udp://8.8.4.4:1111',
    info: {
      machine_id: { part1: 0x44444444, part2: 0x44444444, part3: 0x84444444, part4: 0x44444444 },
      easytier_version: '2.7.1',
      hostname: 'newbox',
      device_os: { os_type: 'linux', version: '1', distribution: 'Debian' },
    },
    location: null,
    networks: [],
    online: true,
    last_seen: new Date().toISOString(),
  }
  const { requests } = await open(page, NEW_ID, { 'GET /machines': () => machines(undefined, [extra]) })
  await expect(page.getByText('还没加入网络')).toBeVisible()
  const join = page.getByRole('button', { name: '加入 home-central' })
  await expect(join).toBeVisible()
  await expect(page.getByRole('button', { name: '选择其他网络' })).toBeVisible()
  await expect(page.getByRole('table', { name: '连接' })).toHaveCount(0)
  await join.click()
  await expect
    .poll(() => requests.find((r) => r.method === 'POST' && r.path === `/networks/${NET}/members`)?.body)
    .toEqual({ device_ids: [NEW_ID], temporary: false })
  expect(rpcCalls(requests)).toHaveLength(0)
})

test('10 (Review Focus 2): offline device never calls proxy-rpc, settings stay usable', async ({ page }) => {
  await page.clock.install()
  const { requests } = await open(page, CORE2, {
    'GET /machines': () =>
      machines((m) => {
        if (m.info.hostname === 'core2') m.online = false
      }),
  })
  await expect(page.getByText('设备离线，恢复连接后显示')).toBeVisible()
  const machinePolls = () => requests.filter((r) => r.method === 'GET' && r.path === '/machines').length
  const pollsBefore = machinePolls()
  await page.clock.runFor(20_000)
  // The shell's 5 s inventory poller fired during those 20 s, so fake time really advanced.
  await expect.poll(machinePolls).toBeGreaterThan(pollsBefore)
  await expect(page.getByText('设备离线，恢复连接后显示')).toBeVisible()
  expect(requests.filter((r) => r.path.includes('/proxy-rpc'))).toEqual([])
  const fix = page.getByTestId('setting-ip').getByRole('button', { name: '设为固定' })
  await expect(fix).toBeEnabled()
  await fix.click()
  await expect(page.getByTestId('setting-ip').getByRole('textbox')).toBeVisible()
  expect(requests.filter((r) => r.path.includes('/proxy-rpc'))).toEqual([])
})

test('11 (Review Focus 3): list_route 500 shows error + 重试; other cards unaffected', async ({ page }) => {
  const { requests } = await open(page, CORE1, {
    'POST /machines/*/proxy-rpc': (req: Request) => {
      const name = (req.postDataJSON() as { method_name: string }).method_name
      if (name === 'list_route') return status(500, { message: 'route table unavailable' })
      return RPC[name] ? fixture(RPC[name]) : {}
    },
  })
  const card = page.getByTestId('connections-card')
  await expect(card).toContainText('route table unavailable')
  await expect(page.getByTestId('overview-card')).toContainText('10.144.144.1')
  await expect(page.getByTestId('setting-ip')).toContainText('固定 · 10.144.144.1')
  const before = rpcCalls(requests, 'list_route').length
  await card.getByRole('button', { name: '重试' }).click()
  await expect.poll(() => rpcCalls(requests, 'list_route').length).toBeGreaterThan(before)
})

test('alias: click name to edit, Enter saves via PUT alias, Esc cancels', async ({ page }) => {
  const { requests } = await open(page, CORE1)
  await page.getByRole('button', { name: /修改别名/ }).click()
  const input = page.getByRole('textbox', { name: '别名' })
  await input.fill('书房')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  expect(requests.some((r) => r.method === 'PUT')).toBe(false)
  await page.getByRole('button', { name: /修改别名/ }).click()
  await page.getByRole('textbox', { name: '别名' }).fill('书房')
  await page.getByRole('textbox', { name: '别名' }).press('Enter')
  await expect
    .poll(() => requests.find((r) => r.method === 'PUT' && r.path === `/machines/${CORE1}/alias`)?.body)
    .toEqual({ alias: '书房' })
})

test('overview card shows key facts and sub-line', async ({ page }) => {
  await open(page, CORE1)
  const ov = page.getByTestId('overview-card')
  await expect(ov).toContainText('home-central · 10.144.144.0/24')
  await expect(ov).toContainText(CORE1)
  await expect(ov).toContainText('2.6.4-8428a89d')
  await expect(ov).toContainText('192.168.97.5')
  await expect(page.getByTestId('detail-subline')).toHaveText('Alpine Linux · 本地网络 · 10.144.144.1')
})

test('unknown device shows a way back to the list', async ({ page }) => {
  await open(page, '99999999-9999-4999-8999-999999999999')
  await expect(page.getByText('找不到这台设备')).toBeVisible()
  await page.getByRole('link', { name: '返回设备列表' }).click()
  await expect(page).toHaveURL(/\/#\/devices$/)
})

test('390px: single column with overview first and no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page, CORE3)
  await expect(page.getByTestId('connections-card')).toContainText('core2')
  const ov = await page.getByTestId('overview-card').boundingBox()
  const conn = await page.getByTestId('connections-card').boundingBox()
  expect(ov!.y).toBeLessThan(conn!.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
