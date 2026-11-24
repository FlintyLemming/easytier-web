import { defineConfig, devices } from '@playwright/test'
import { LIVE_API } from './tests/live/env'

// Live migration rehearsal against the data-migrate testenv (testenv/README.md 「迁移演练环境」).
// Same dev server as the live smoke (port 5199); runs one long test.
export default defineConfig({
  testDir: 'tests/live-migrate',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    env: { ET_API: LIVE_API },
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
