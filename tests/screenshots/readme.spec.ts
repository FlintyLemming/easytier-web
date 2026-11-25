/**
 * README screenshots (docs/screenshots/*.png), rendered against mocked data: the 20-device fleet
 * (tests/e2e/fleet.ts) and the migration rehearsal fixtures (tests/e2e/migrateMock.ts).
 * Run: npx playwright test -c playwright.screenshots.config.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { fleetLocationCache, fleetMock } from '../e2e/fleet'
import { migrateMock } from '../e2e/migrateMock'
import { mockApi, type Overrides } from '../e2e/mockApi'

const OUT = 'docs/screenshots/'

/** Operating systems by hostname (the fleet reports Debian everywhere). */
const OS: Record<string, string> = {
  'router-ax6000': 'OpenWrt',
  'sz-box': 'OpenWrt',
  'macbook-pro': 'macOS',
  'office-pc': 'Windows',
  'old-laptop': 'Windows',
  'sh-pi': 'Raspberry Pi OS',
  'nj-nuc': 'Ubuntu',
  'bj-vps': 'Ubuntu',
  'hk-mini': 'Ubuntu',
  'la-vps': 'Ubuntu',
  'lab-a': 'Alpine',
  'lab-b': 'Alpine',
}

/** Deterministic 32-bit integer hash. */
function hash(n: number, salt: number): number {
  let h = Math.imul(n ^ (salt * 0x9e3779b9), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) * 3
}

/** Real-looking versions, operating systems and traffic counters on top of the fleet's test data. */
function polish(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/-fleet$/, '-8a3c4f5e')
  if (Array.isArray(v)) return v.map(polish)
  if (!v || typeof v !== 'object') return v
  const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, polish(x)])) as Record<string, any>
  if (typeof o.hostname === 'string' && o.device_os && OS[o.hostname]) {
    o.device_os = { ...o.device_os, distribution: OS[o.hostname] }
  }
  if (typeof o.conn_id === 'string' && o.stats) {
    const seed = Number(o.conn_id.slice(-6))
    o.stats = { ...o.stats, rx_bytes: String(hash(seed, 1) % 12e9), tx_bytes: String(hash(seed, 2) % 4e9) }
  }
  return o
}

function polished(overrides: Overrides): Overrides {
  return Object.fromEntries(Object.entries(overrides).map(([k, h]) => [k, async (req) => polish(await h(req))]))
}

function fleet() {
  const m = fleetMock()
  const memberId = (nn: string) => `00000000-0000-4000-9000-0000000000${nn}`
  Object.assign(m.overrides, {
    [`GET /networks/${m.networkId}`]: () => ({
      network_id: m.networkId,
      display_name: '家庭网',
      network_name: 'home',
      network_secret: 'example-secret',
      networking_method: 'Manual',
      virtual_cidr: '10.144.0.0/24',
      secure_mode: false,
      public_server_url: null,
      peer_urls: ['tcp://public.example.com:11010'],
      member_count: 19,
    }),
    [`GET /networks/${m.networkId}/acl-policy`]: () => ({
      policy: {
        default_action: 'allow',
        rules: [
          {
            id: 'r1', name: 'lab-no-ssh', enabled: true, action: 'deny',
            sources: [{ type: 'all' }],
            destinations: [{ type: 'member', member_id: memberId('19') }, { type: 'member', member_id: memberId('20') }],
            protocols: [{ protocol: 'tcp', ports: ['22'], stateful: true }],
          },
          {
            id: 'r2', name: 'nas-from-laptop', enabled: true, action: 'allow',
            sources: [{ type: 'member', member_id: memberId('03') }],
            destinations: [{ type: 'member', member_id: memberId('02') }],
            protocols: [{ protocol: 'tcp', ports: ['445', '5000-5001'], stateful: true }],
          },
          {
            id: 'r3', name: 'quarantine-old-laptop', enabled: false, action: 'deny',
            sources: [{ type: 'member', member_id: memberId('07') }],
            destinations: [{ type: 'all' }],
            protocols: [{ protocol: 'any', ports: [], stateful: false }],
          },
        ],
      },
    }),
  })
  return { ...m, overrides: polished(m.overrides) }
}

async function openFleet(page: Page, hash: string) {
  const m = fleet()
  await mockApi(page, m.overrides)
  const cache = JSON.stringify(fleetLocationCache(m.ids))
  await page.addInitScript((c) => localStorage.setItem('et.locations.admin', c), cache)
  const path = hash.replace('{net}', m.networkId).replace(/\{([\w-]+)\}/g, (_, n: string) => m.ids[n] ?? n)
  await page.goto(`/#${path}`)
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage })
}

test('overview', async ({ page }) => {
  await openFleet(page, '/')
  await expect(page.getByTestId('stat-direct').getByText('98%')).toBeVisible()
  await shot(page, 'overview', true)
})

test('devices', async ({ page }) => {
  await openFleet(page, '/devices')
  await expect(page.getByText('router-ax6000').first()).toBeVisible()
  await shot(page, 'devices')
})

test('device detail', async ({ page }) => {
  await openFleet(page, '/devices/{home-nas}')
  await expect(page.getByText('public-server')).toBeVisible()
  await shot(page, 'device-detail')
})

test('network members', async ({ page }) => {
  await openFleet(page, '/networks/{net}')
  await expect(page.getByTestId('member-row').first()).toBeVisible()
  await shot(page, 'network-members')
})

test('network acl', async ({ page }) => {
  await openFleet(page, '/networks/{net}?tab=acl')
  await expect(page.getByText('quarantine-old-laptop')).toBeVisible()
  await shot(page, 'network-acl')
})

test('migration wizard', async ({ page }) => {
  await mockApi(page, migrateMock().overrides)
  await page.goto('/#/migrate')
  await page.getByTestId('legacy-group').filter({ hasText: 'office' }).getByRole('button', { name: '迁移这一组' }).click()
  await page.getByTestId('wizard-step-network').getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('wizard-step-preview')).toBeVisible()
  await shot(page, 'migration')
})
