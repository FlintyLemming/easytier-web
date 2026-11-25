import { expect, test, type Page } from '@playwright/test'
import { fleetLocationCache, fleetMock } from './fleet'
import { fixture, mockApi, type Overrides } from './mockApi'
import { strToUuid } from '../../src/lib/uuid'

test('overview heading, nav state and logo navigation', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { level: 1, name: '概览' })).toBeVisible()
  await expect(page.getByText('每 10 秒自动刷新')).toBeVisible()
  const nav = page.getByRole('navigation', { name: '主导航' })
  await expect(nav.getByRole('link', { name: '概览' })).toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: '设备' }).click()
  await expect(page).toHaveURL(/#\/devices$/)
  await expect(nav.getByRole('link', { name: '概览' })).not.toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: /EasyTier/ }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { level: 1, name: '概览' })).toBeVisible()
})

test('stat cards show the fleet totals', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  const online = page.getByTestId('stat-online')
  await expect(online.getByText('18', { exact: true })).toBeVisible()
  await expect(online.getByText('/ 20')).toBeVisible()
  await expect(online.getByText('2 台离线')).toBeVisible()
  const networks = page.getByTestId('stat-networks')
  await expect(networks.getByText('1', { exact: true })).toBeVisible()
  await expect(networks).toContainText('家庭网 · 10.144.0.0/24')
  const direct = page.getByTestId('stat-direct')
  await expect(direct.getByText('98%')).toBeVisible()
  await expect(direct.getByText('136 条连接中 3 条走中继')).toBeVisible()
  const outdated = page.getByTestId('stat-outdated')
  await expect(outdated.getByText('3', { exact: true })).toBeVisible()
  await expect(outdated).toContainText('最新版本 2.7.1')
})

test('direct rate reads 正在读取连接… until proxy-rpc answers', async ({ page }) => {
  const { overrides } = fleetMock()
  const rpc = overrides['POST /machines/*/proxy-rpc']!
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  overrides['POST /machines/*/proxy-rpc'] = async (req) => {
    await gate
    return rpc(req)
  }
  await mockApi(page, overrides)
  await page.goto('/#/')
  const direct = page.getByTestId('stat-direct')
  await expect(direct.getByText('正在读取连接…')).toBeVisible()
  await expect(direct.getByText('—', { exact: true })).toBeVisible()
  release()
  await expect(direct.getByText('98%')).toBeVisible()
})

test('leaving the overview starts no further fleet requests', async ({ page }) => {
  const { overrides } = fleetMock()
  const rpc = overrides['POST /machines/*/proxy-rpc']!
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  overrides['POST /machines/*/proxy-rpc'] = async (req) => {
    await gate
    return rpc(req)
  }
  const { requests } = await mockApi(page, overrides)
  const rpcs = () => requests.filter((r) => r.path.endsWith('/proxy-rpc')).length
  await page.goto('/#/')
  // The global limiter lets four calls out: two devices' routes and peers.
  await expect.poll(rpcs).toBe(4)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设备' }).click()
  await expect(page).toHaveURL(/#\/devices$/)
  release()
  // The four devices already started finish (two calls each); none of the other 13 starts.
  await expect.poll(rpcs).toBe(8)
  await page.waitForTimeout(1000)
  expect(rpcs()).toBe(8)
})

test('webhook mode shows two cells and makes no proxy-rpc requests', async ({ page }) => {
  const { requests } = await mockApi(page, {}, { webhook: true })
  await page.goto('/#/')
  await expect(page.getByTestId('stat-online')).toBeVisible()
  await expect(page.getByTestId('stat-outdated')).toBeVisible()
  await expect(page.getByTestId('stat-networks')).toHaveCount(0)
  await expect(page.getByTestId('stat-direct')).toHaveCount(0)
  await page.waitForTimeout(2000)
  expect(requests.filter((r) => r.path.endsWith('/proxy-rpc'))).toHaveLength(0)
})

test('attention list shows the five fleet items in order', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  const list = page.getByTestId('attention-list')
  await expect(list.getByRole('heading', { name: '需要关注 · 5' })).toBeVisible()
  const rows = list.getByTestId('attention-row')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('unknown-pc 被拉黑后仍在尝试连接')
  await expect(rows.nth(0)).toContainText('已拉黑 · 共尝试 5 次 · 最后 10 分钟前')
  await expect(rows.nth(0).getByRole('button', { name: '解除拉黑 unknown-pc', exact: true })).toHaveText('解除拉黑')
  await expect(rows.nth(1)).toContainText('sh-pi 还没加入网络')
  await expect(rows.nth(1).getByRole('button', { name: '将 sh-pi 加入 家庭网', exact: true })).toHaveText('加入 家庭网')
  await expect(rows.nth(2)).toContainText('fra-backup 已离线 2 天')
  await expect(rows.nth(3)).toContainText('old-laptop 已离线 3 周')
  await expect(rows.nth(4)).toContainText('3 台设备可更新')
  await expect(rows.nth(4)).toContainText('fra-backup、office-pc 2.6.4')
  await expect(rows.nth(4)).toContainText('old-laptop 2.5.0')
  await expect(rows.nth(4).textContent()).resolves.toMatch(/2\.6\.4.*2\.5\.0/)
})

test('attention actions unblock and join', async ({ page }) => {
  const { overrides, ids, networkId } = fleetMock()
  const { requests } = await mockApi(page, overrides)
  await page.goto('/#/')
  const rows = page.getByTestId('attention-row')
  await rows.nth(0).getByRole('button', { name: /解除拉黑/ }).click()
  await expect.poll(() => requests.some((r) => r.method === 'DELETE' && r.path === '/blocked-devices/99999999-0000-4000-8000-000000000001')).toBe(true)
  await rows.nth(1).getByRole('button', { name: /加入 家庭网/ }).click()
  await expect
    .poll(() => requests.find((r) => r.method === 'POST' && r.path === `/networks/${networkId}/members`)?.body)
    .toEqual({ device_ids: [ids['sh-pi']], temporary: false })
})

test('attention list expands beyond five rows and collapses again', async ({ page }) => {
  const { overrides } = fleetMock()
  const base = overrides['GET /machines']!
  overrides['GET /machines'] = async (req) => {
    const { machines } = (await base(req)) as { machines: Record<string, any>[] }
    const extra = [1, 2].map((n) => ({
      ...machines[0]!,
      client_url: `tcp://9.9.9.${n}:1`,
      info: { ...machines[0]!.info, machine_id: strToUuid(`00000000-0000-4000-8000-0000000009${n}0`), hostname: `extra-${n}` },
      networks: machines[0]!.networks,
      online: false,
      location: null,
      last_seen: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(),
    }))
    return { machines: [...machines, ...extra] }
  }
  await mockApi(page, overrides)
  await page.goto('/#/')
  const list = page.getByTestId('attention-list')
  await expect(list.getByRole('heading', { name: '需要关注 · 7' })).toBeVisible()
  await expect(list.getByTestId('attention-row')).toHaveCount(5)
  const all = list.getByRole('button', { name: '全部 (7)' })
  await expect(all).toHaveAttribute('aria-expanded', 'false')
  await all.click()
  await expect(list.getByTestId('attention-row')).toHaveCount(7)
  const collapse = list.getByRole('button', { name: '收起' })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await collapse.click()
  await expect(list.getByTestId('attention-row')).toHaveCount(5)
  await expect(all).toHaveAttribute('aria-expanded', 'false')
})

test('connection quality lists the slowest relays first', async ({ page }) => {
  await mockApi(page, fleetMock().overrides)
  await page.goto('/#/')
  const card = page.getByTestId('connection-quality')
  await expect(card).toContainText('中继 3 · 直连 133')
  const rows = card.getByTestId('quality-row')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('la-vps')
  await expect(rows.nth(0)).toContainText('bj-dev')
  await expect(rows.nth(0)).toContainText('中继 · 经 hk-vps')
  await expect(rows.nth(0)).toContainText('186 ms')
  await expect(rows.nth(1)).toContainText('la-vps')
  await expect(rows.nth(1)).toContainText('sh-dev')
  await expect(rows.nth(1)).toContainText('170 ms')
})

test('webhook mode has no connection quality and no unjoined rows', async ({ page }) => {
  await mockApi(page, {}, { webhook: true })
  await page.goto('/#/')
  await expect(page.getByTestId('attention-list')).toBeVisible()
  await expect(page.getByTestId('connection-quality')).toHaveCount(0)
  await expect(page.getByText('还没加入网络')).toHaveCount(0)
})

test.describe('node map', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  /**
   * The fleet with the two offline devices' cached locations (上海, 法兰克福) seeded. `tweak` edits the
   * mock before the page loads (it gets the fleet's device ids).
   */
  async function openFleet(page: Page, tweak?: (overrides: Overrides, ids: Record<string, string>) => void) {
    const { overrides, ids } = fleetMock()
    tweak?.(overrides, ids)
    const cache = JSON.stringify(fleetLocationCache(ids))
    await page.addInitScript((c) => localStorage.setItem('et.locations.admin', c), cache)
    const api = await mockApi(page, overrides)
    await page.goto('/#/')
    const map = page.getByTestId('node-map')
    await expect(map.locator('[data-cluster]').first()).toBeVisible()
    return { map, ...api }
  }
  const cluster = (map: ReturnType<Page['getByTestId']>, prefix: string) => map.locator(`[data-cluster][aria-label^="${prefix}"]`)

  test('focus view shows the East Asian clusters and edge chips for the far ones', async ({ page }) => {
    const { map } = await openFleet(page)
    const group = page.getByRole('group', { name: '节点分布地图' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('button', { name: /^上海，/ })).toHaveCount(1)
    for (const city of ['上海', '南京', '北京', '东京']) await expect(cluster(map, city)).toHaveCount(1)
    await expect(map.locator('[data-cluster][aria-label="香港 等 2 地，3 台设备，3 台在线"]')).toHaveCount(1)
    await expect(cluster(map, '洛杉矶')).toHaveCount(0)
    const box = (await map.locator('svg').first().boundingBox())!
    const mid = box.x + box.width / 2
    const la = map.getByRole('button', { name: '洛杉矶，1 台设备，切换到世界视图' })
    await expect(la).toHaveText('洛杉矶 1 →')
    const laBox = (await la.boundingBox())!
    expect(laBox.x).toBeGreaterThan(mid)
    const fra = map.getByRole('button', { name: '法兰克福，1 台设备，切换到世界视图' })
    await expect(fra).toHaveText('← 法兰克福 1')
    const fraBox = (await fra.boundingBox())!
    expect(fraBox.x + fraBox.width).toBeLessThan(mid)
  })

  test('hovering a cluster lists its devices; clicking it filters the device list', async ({ page }) => {
    const { map } = await openFleet(page)
    const sh = cluster(map, '上海')
    await sh.hover()
    const card = map.getByTestId('map-hover-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('上海')
    await expect(card).toContainText('6/7 在线')
    await expect(card.getByTestId('hover-device')).toHaveCount(6)
    await expect(card).toContainText('还有 1 台 · 点击查看全部')
    await page.mouse.move(5, 5)
    await expect(card).toHaveCount(0)
    await sh.click()
    await expect.poll(() => decodeURIComponent(page.url())).toMatch(/#\/devices\?city=上海$/)
    await expect(page.getByRole('row').filter({ has: page.getByTestId('device-name') })).toHaveCount(7)
  })

  test('a place lists every device it counts, whatever their location text', async ({ page }) => {
    // 台州 is not in the city table, so all three resolve to the province 浙江.
    await mockApi(page, {
      'GET /machines': () => {
        const data = fixture('machines.json')
        data.machines[0].location = { country: '中国', region: '浙江', city: null }
        data.machines[1].location = { country: '中国', region: '浙江', city: null }
        data.machines[2].location = { country: '中国', region: '浙江', city: '台州' }
        return data
      },
    })
    await page.goto('/#/')
    const zj = page.getByTestId('node-map').locator('[data-cluster]')
    await expect(zj).toHaveCount(1)
    await expect(zj).toHaveAttribute('aria-label', '浙江，3 台设备，3 台在线')
    await zj.click()
    await expect.poll(() => decodeURIComponent(page.url())).toMatch(/#\/devices\?city=浙江&city=台州$/)
    const listed = page.getByRole('row').filter({ has: page.getByTestId('device-name') })
    await expect(listed).toHaveCount(3)
    await page.goBack()
    const row = page.getByTestId('ranking-row').filter({ hasText: '浙江' })
    await expect(row).toContainText('3/3')
    await row.getByRole('link').click()
    await expect.poll(() => decodeURIComponent(page.url())).toMatch(/#\/devices\?city=浙江&city=台州$/)
    await expect(listed).toHaveCount(3)
  })

  test('keyboard focus shows the card, Esc hides it, Enter opens the filtered list', async ({ page }) => {
    const { map } = await openFleet(page)
    const nj = cluster(map, '南京')
    await nj.focus()
    const card = map.getByTestId('map-hover-card')
    await expect(card).toContainText('3/3 在线')
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect.poll(() => decodeURIComponent(page.url())).toMatch(/#\/devices\?city=南京$/)
  })

  test('English counts use singular and plural forms', async ({ page }) => {
    const { overrides, ids } = fleetMock()
    const cache = JSON.stringify(fleetLocationCache(ids))
    await page.addInitScript((c) => localStorage.setItem('et.locations.admin', c), cache)
    await mockApi(page, overrides, { locale: 'en' })
    await page.goto('/#/')
    const map = page.getByTestId('node-map')
    await expect(map.locator('[data-cluster][aria-label="上海, 7 devices, 6 online"]')).toHaveCount(1)
    await expect(map.locator('[data-cluster][aria-label="东京, 1 device, 1 online"]')).toHaveCount(1)
    await expect(map.getByRole('button', { name: '洛杉矶, 1 device, switch to the world view', exact: true })).toBeVisible()
    await expect(page.getByTestId('attention-row').nth(4)).toContainText('3 devices can be updated')
    await expect(page.getByTestId('attention-row').nth(0)).toContainText('Blocked · 5 attempts · last')
    await expect(page.getByTestId('stat-direct')).toContainText('3 of 136 connections relayed')
  })

  test('an edge chip switches to the world view', async ({ page }) => {
    const { map } = await openFleet(page)
    const world = page.getByRole('button', { name: '世界', exact: true })
    await expect(world).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: '聚焦', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await map.getByText('← 法兰克福 1').click()
    await expect(world).toHaveAttribute('aria-pressed', 'true')
    await expect(cluster(map, '洛杉矶')).toHaveCount(1)
    await expect(cluster(map, '法兰克福')).toHaveAttribute('data-offline', '')
    await expect(cluster(map, '洛杉矶')).not.toHaveAttribute('data-offline', '')
    await expect(map.getByText('洛杉矶 1 →')).toHaveCount(0)
  })

  test('connection arcs, relays dashed, and the 连接线 toggle', async ({ page }) => {
    const { map } = await openFleet(page)
    await expect.poll(() => map.locator('[data-arc]').count()).toBeGreaterThan(0)
    await expect.poll(() => map.locator('[data-relay]').count()).toBeGreaterThanOrEqual(1)
    await expect(map.locator('[data-relay]').first()).toHaveAttribute('stroke-dasharray', '4 4')
    const legend = map.getByTestId('map-legend')
    await expect(legend).toContainText('直连 P2P')
    await expect(legend).toContainText('中继')
    await expect(legend).toContainText('全部离线')
    const lines = page.getByRole('button', { name: '连接线' })
    await expect(lines).toHaveAttribute('aria-pressed', 'true')
    await lines.click()
    await expect(lines).toHaveAttribute('aria-pressed', 'false')
    await expect(map.locator('[data-arc]')).toHaveCount(0)
    await expect(legend).toHaveCount(0)
  })

  // Like a device on a flaky long-haul link: its proxy-rpc calls hang until the client's 8-second
  // timeout. The other 16 online members still report their links to it, so every pair is known.
  test('a device that never answers holds back neither the direct rate nor the connection lines', async ({ page }) => {
    const { map } = await openFleet(page, (overrides, ids) => {
      const rpc = overrides['POST /machines/*/proxy-rpc']!
      overrides['POST /machines/*/proxy-rpc'] = (req) =>
        new URL(req.url()).pathname.split('/').at(-2) === ids['hk-mini'] ? new Promise(() => {}) : rpc(req)
    })
    const direct = page.getByTestId('stat-direct')
    await expect(direct.getByText('98%')).toBeVisible()
    await expect(direct.getByText('136 条连接中 3 条走中继')).toBeVisible()
    await expect(page.getByRole('button', { name: '连接线' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => map.locator('[data-arc]').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('connection-quality')).toContainText('中继 3 · 直连 133')
  })

  test('location ranking rows link to the filtered device list', async ({ page }) => {
    await openFleet(page)
    const ranking = page.getByTestId('location-ranking')
    await expect(ranking).toContainText('按位置 · 在线/总数')
    const rows = ranking.getByTestId('ranking-row')
    await expect(rows.first()).toContainText('上海')
    await expect(rows.first()).toContainText('6/7')
    const local = rows.filter({ hasText: '本地网络' })
    await expect(local).toContainText('无公网位置')
    await expect(local).toContainText('2/2')
    await local.getByRole('link').click()
    await expect.poll(() => decodeURIComponent(page.url())).toMatch(/#\/devices\?city=本地网络$/)
    const listed = page.getByRole('row').filter({ has: page.getByTestId('device-name') })
    await expect(listed).toHaveCount(2)
    await expect(listed.nth(0)).toContainText('lab-a')
    await expect(listed.nth(1)).toContainText('lab-b')
  })

  test('header counts located and local devices', async ({ page }) => {
    await openFleet(page)
    const section = page.getByTestId('map-section')
    await expect(section.getByRole('heading', { name: '节点分布' })).toBeVisible()
    await expect(section).toContainText('18 台已定位 · 2 台在本地网络')
    await expect(section).not.toContainText('台未定位')
    await expect(section).not.toContainText('--geoip-db')
  })

  test('the overview makes no third-party requests', async ({ page, baseURL }) => {
    const urls: string[] = []
    page.on('request', (r) => urls.push(r.url()))
    const { map } = await openFleet(page)
    await expect.poll(() => map.locator('[data-arc]').count()).toBeGreaterThan(0)
    const origin = new URL(baseURL!).origin
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((u) => !u.startsWith(origin + '/'))).toEqual([])
  })

  test('without locatable devices the map shows its empty state', async ({ page }) => {
    await mockApi(page)
    await page.goto('/#/')
    const section = page.getByTestId('map-section')
    await expect(section.getByText('还没有可以定位的设备')).toBeVisible()
    await expect(section.getByText('设备的位置来自公网 IP。在本地网络中、或者位置未知的设备不会显示在地图上。')).toBeVisible()
    await expect(section.locator('[data-cluster]')).toHaveCount(0)
    await expect(page.getByTestId('stat-direct')).not.toContainText('正在读取连接…')
    await expect(page.getByRole('button', { name: '连接线' })).toHaveCount(0)
    await expect(section.getByTestId('map-legend')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '聚焦', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '世界', exact: true })).toHaveCount(0)
    const local = page.getByTestId('ranking-row').filter({ hasText: '本地网络' })
    await expect(local).toContainText('3/3')
    await expect(section).toContainText('0 台已定位 · 3 台在本地网络')
    expect(await page.locator('body').innerText()).not.toContain('NaN')
    expect(await section.locator('svg').first().innerHTML()).not.toContain('NaN')
  })

  test('country-only locations make one dot and a precision hint', async ({ page }) => {
    await mockApi(page, {
      'GET /machines': () => {
        const data = fixture('machines.json')
        for (const m of data.machines) m.location = { country: '中国' }
        return data
      },
    })
    await page.goto('/#/')
    const map = page.getByTestId('node-map')
    const clusters = map.locator('[data-cluster]')
    await expect(clusters).toHaveCount(1)
    await expect(clusters.first()).toHaveAttribute('aria-label', '中国，3 台设备，3 台在线')
    await expect(clusters.first()).toContainText('中国')
    // One place: no line could be drawn.
    await expect(page.getByTestId('stat-direct')).not.toContainText('正在读取连接…')
    await expect(page.getByRole('button', { name: '连接线' })).toHaveCount(0)
    await expect(map.getByTestId('map-legend')).toHaveCount(0)
    const hint = page.getByTestId('map-precision-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('--geoip-db')
    await expect(hint.locator('.font-mono')).toHaveText('--geoip-db')
  })

  test('the map follows the width of its container', async ({ page }) => {
    const { map } = await openFleet(page)
    const svg = map.locator('svg').first()
    const before = (await svg.boundingBox())!.width
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect.poll(async () => (await svg.boundingBox())!.width).toBeLessThan(before - 50)
    const box = (await map.boundingBox())!
    expect((await svg.boundingBox())!.width).toBeCloseTo(box.width, 0)
  })

  test('narrow screens stack the ranking under the map without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { map } = await openFleet(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    const mapBox = (await map.boundingBox())!
    const rankBox = (await page.getByTestId('location-ranking').boundingBox())!
    expect(rankBox.y).toBeGreaterThan(mapBox.y + mapBox.height)
    expect((await map.locator('svg').first().boundingBox())!.height).toBe(260)
  })
})

test('webhook mode draws the map without connection lines', async ({ page }) => {
  await mockApi(page, {}, { webhook: true })
  await page.goto('/#/')
  const section = page.getByTestId('map-section')
  await expect(section).toContainText('0 台已定位 · 3 台在本地网络')
  await expect(page.getByRole('button', { name: '连接线' })).toHaveCount(0)
  await expect(section.locator('[data-arc]')).toHaveCount(0)
  await expect(section.getByTestId('map-legend')).toHaveCount(0)
})
