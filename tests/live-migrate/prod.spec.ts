import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { stripSourceTable } from '../../src/domain/migration/compare'

/**
 * Production-copy rehearsal (plan 6 Task 10): the wizard on a local copy of the production
 * database (testenv/prod-rehearsal.ts). Runs only with ET_PROD_REHEARSAL=1 and
 * ET_LIVE_API=http://localhost:11311. Observations (with real names) go to
 * test-results/prod-rehearsal-observed.json, which is git-ignored; the report uses 设备 N.
 */
test.skip(process.env.ET_PROD_REHEARSAL !== '1', 'production-copy rehearsal only (testenv/prod-rehearsal.ts)')

const DIR = fileURLToPath(new URL('../../testenv/data-prod/', import.meta.url))
const OBSERVED = fileURLToPath(new URL('../../test-results/prod-rehearsal-observed.json', import.meta.url))
interface Meta { user: string; devices: { id: string; label: string; hostname: string }[] }
interface Snapshot { devices: Record<string, { running: string[] }>; toml: Record<string, string> }

const FINAL = /^(已迁移|已回滚|需要处理)/

async function login(page: Page, user: string) {
  await page.addInitScript(() => {
    try { localStorage.setItem('et.locale', 'zh-CN') } catch { /* ignore */ }
  })
  await page.goto('/#/login')
  await page.getByLabel('用户名').fill(user)
  await page.getByLabel('密码').fill('admin')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/#\/$/)
}

async function nodeToml(req: APIRequestContext, device: string, inst: string): Promise<string> {
  const h = inst.replace(/-/g, '')
  const id = { part1: parseInt(h.slice(0, 8), 16), part2: parseInt(h.slice(8, 16), 16), part3: parseInt(h.slice(16, 24), 16), part4: parseInt(h.slice(24), 16) }
  const res = await req.post(`/api/v1/machines/${device}/proxy-rpc`, {
    data: { service_name: 'api.instance.PeerManageRpcService', method_name: 'show_node_info', payload: { instance: { id } } },
  })
  if (!res.ok()) throw new Error(`proxy-rpc ${res.status()}`)
  return ((await res.json()) as { node_info?: { config?: string } }).node_info?.config ?? ''
}

const texts = (page: Page, selector: string) => page.locator(selector).allInnerTexts()

test('production-copy rehearsal: group A through the wizard, verify, roll back one device', async ({ page }) => {
  test.setTimeout(150 * 60_000)
  const meta = JSON.parse(readFileSync(DIR + 'rehearsal-meta.json', 'utf8')) as Meta
  const snap = JSON.parse(readFileSync(DIR + 'snapshot.json', 'utf8')) as Snapshot
  const labelOf = (name: string) => meta.devices.find((d) => d.hostname === name.trim())?.label ?? `?(${name})`
  const observed: Record<string, unknown> = { startedAt: new Date().toISOString() }
  const t0 = Date.now()
  const mark = (k: string) => (observed[`${k}Ms`] = Date.now() - t0)
  try {
    await login(page, meta.user)

    // Step 1: inventory.
    await page.goto('/#/migrate')
    const rows = page.locator('tr[data-testid="legacy-group"]')
    await expect(rows.first()).toBeVisible({ timeout: 300_000 })
    await expect(page.getByText(/正在读取 \d+ \/ \d+ 台设备/)).toHaveCount(0, { timeout: 300_000 })
    mark('inventory')
    observed.offline = await page.getByTestId('offline-devices').count()
    observed.failed = await page.getByTestId('failed-devices').count()
    const groups = []
    for (let i = 0; i < (await rows.count()); i++) {
      const r = rows.nth(i)
      groups.push({
        index: i,
        instances: Number(await r.getByTestId('count-instances').innerText()),
        running: Number(await r.getByTestId('count-running').innerText()),
        disabled: Number(await r.getByTestId('count-disabled').innerText()),
        target: (await r.locator('td').nth(4).innerText()).trim(),
      })
    }
    observed.groups = groups
    const a = [...groups].sort((x, y) => y.instances - x.instances)[0]!

    // Step 2.
    await rows.nth(a.index).getByRole('button', { name: '迁移这一组' }).click()
    const network = page.getByTestId('wizard-step-network')
    await expect(network).toBeVisible()
    observed.conflicts = (await network.getByTestId('draft-conflicts').count()) ? await network.getByTestId('draft-conflicts').innerText() : ''
    observed.splitWarning = await network.getByText('迁移后的设备和还没迁移的设备将不在同一个虚拟网络里').count()
    const next2 = network.getByRole('button', { name: '下一步' })
    await expect(next2, 'the draft of group A is valid').toBeEnabled()
    await next2.click()

    // Step 3.
    const preview = page.getByTestId('wizard-step-preview')
    await expect(preview).toBeVisible()
    const cards = page.getByTestId('device-preview')
    const perDevice = []
    for (let i = 0; i < (await cards.count()); i++) {
      const c = cards.nth(i)
      const name = await c.locator('h3').innerText()
      perDevice.push({
        label: labelOf(name),
        migrate: await c.getByRole('radio', { name: '迁移', exact: true }).isChecked().catch(() => false),
        alreadyMember: (await c.getByText('已是成员，跳过').count()) > 0,
        blockers: await c.locator('li.text-error').allInnerTexts(),
        changes: (await c.getByTestId('changes').count()) ? await c.getByTestId('changes').locator('li > span').allInnerTexts() : [],
        override: (await c.getByTestId('override-fields').locator('li > span.text-muted').allInnerTexts()),
        member: await c.getByTestId('member-fields').innerText(),
      })
    }
    observed.preview = perDevice
    // Production devices share fixed IPs; the wizard switches all but the first device of each
    // shared address to an auto-selected free one by default (a change confirmed below).
    observed.autoSelected = perDevice.filter((d) => d.member.includes('（自动选择）')).map((d) => d.label)
    observed.summary = await page.getByTestId('change-summary').innerText()
    for (const b of await page.locator('[data-testid^="confirm-kind-"]').all()) if (await b.isEnabled()) await b.click()
    const next3 = preview.getByRole('button', { name: '下一步' })
    await expect(next3, 'every change confirmed and no unresolved duplicate IP').toBeEnabled()
    await next3.click()
    mark('previewed')

    // Step 4.
    const exec = page.getByTestId('wizard-step-execute')
    await exec.getByLabel('我已经按升级手册备份了 et.db').check()
    const [download] = await Promise.all([page.waitForEvent('download'), exec.getByRole('button', { name: '下载备份并开始迁移' }).click()])
    observed.exportFile = download.suggestedFilename().replace(/^easytier-migration-.*-(\d{8}-\d{6})\.json$/, 'easytier-migration-<network>-$1.json')
    const runStart = Date.now()
    const statuses = '[data-testid="execute-device"] [role="status"]'
    const total = await page.locator(statuses).count()
    await expect
      .poll(async () => (await texts(page, statuses)).filter((s) => FINAL.test(s.trim())).length, { timeout: 120 * 60_000, intervals: [5_000] })
      .toBe(total)
    observed.runMs = Date.now() - runStart
    mark('executed')
    const rowsText = await texts(page, '[data-testid="execute-device"]')
    observed.outcomes = rowsText.map((t) => {
      const [name, , ...status] = t.split('\n').map((s) => s.trim()).filter(Boolean)
      return { label: labelOf(name ?? ''), status: status.join(' ') }
    })

    // Step 5: verification.
    await exec.getByRole('button', { name: '查看校验报告' }).click()
    const report = page.getByTestId('wizard-step-report')
    await expect(report).toBeVisible()
    await expect.poll(async () => (await texts(page, '[data-testid="report-status"]')).filter((s) => s.includes('校验中')).length, { timeout: 20 * 60_000 }).toBe(0)
    mark('verified')
    const reportRows = page.getByTestId('report-device')
    const verification = []
    for (let i = 0; i < (await reportRows.count()); i++) {
      const r = reportRows.nth(i)
      const name = await r.locator('p').first().innerText()
      verification.push({
        label: labelOf(name),
        name,
        status: await r.getByTestId('report-status').innerText(),
        diffs: await r.locator('ul li').allInnerTexts(),
      })
    }
    observed.verification = verification.map((v) => ({ label: v.label, status: v.status, diffs: v.diffs }))
    observed.aclNote = (await report.getByText(/这些设备迁移前单独配置了 ACL/).count()) > 0

    // Roll back one consistent device — one that got an auto-selected address, so the rollback must
    // bring its shared legacy address back — and compare its TOML with the pre-upgrade snapshot.
    const auto = new Set(observed.autoSelected as string[])
    // Only a uniquely named device maps back to its machine id (a few rehearsal devices share a hostname).
    const unique = (v: { name: string }) => meta.devices.filter((d) => d.hostname === v.name.trim()).length === 1
    const pick =
      verification.find((v) => v.status === '一致' && auto.has(v.label) && unique(v)) ?? verification.find((v) => v.status === '一致' && unique(v))
    expect(pick, 'a consistent device to roll back').toBeTruthy()
    const dev = meta.devices.find((d) => d.label === pick!.label)!
    const rbStart = Date.now()
    const pickedRow = reportRows.filter({ has: page.getByText(pick!.name, { exact: true }) })
    await pickedRow.getByRole('button', { name: '回滚这台…' }).click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: '回滚' }).click()
    await expect(pickedRow.getByTestId('report-status')).toHaveText('已回滚', { timeout: 10 * 60_000 })
    observed.rollback = { label: dev.label, ms: Date.now() - rbStart }
    const inst = snap.devices[dev.id]!.running[0]!
    const toml = await nodeToml(page.request, dev.id, inst)
    // Two upstream effects are not differences in what runs: the `[source]` marker web v2.7.1 puts
    // on instances it creates, and the `hostname` line equal to the OS hostname, which v2.7.1 drops
    // from the stored config when it disables a running instance (a 2.6.4 core omits it from its
    // running view); without it the core uses the OS hostname, the same value.
    const normalize = (t: string) =>
      stripSourceTable(t).split('\n').filter((l) => l !== `hostname = "${dev.hostname}"`).join('\n').trimEnd().split('\n')
    observed.rollbackToml = {
      identical: toml === snap.toml[inst],
      identicalWithoutSource: stripSourceTable(toml) === stripSourceTable(snap.toml[inst]!),
      identicalNormalized: normalize(toml).join('\n') === normalize(snap.toml[inst]!).join('\n'),
    }
    expect(normalize(toml)).toEqual(normalize(snap.toml[inst]!))
  } finally {
    observed.finishedAt = new Date().toISOString()
    writeFileSync(OBSERVED, JSON.stringify(observed, null, 2) + '\n')
  }
})
