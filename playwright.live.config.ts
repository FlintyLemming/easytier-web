import { defineConfig, devices } from '@playwright/test'
import { LIVE_API } from './tests/live/env'

// Live smoke against the local testenv (web v2.7.1 on :11211). Port 5199 — never 5198 (mocked e2e).
export default defineConfig({
  testDir: 'tests/live',
  timeout: 120_000,
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
