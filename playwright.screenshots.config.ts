import { defineConfig, devices } from '@playwright/test'

// README screenshots against the mocked 20-device fleet (tests/e2e/fleet.ts). Port 5197.
// npx playwright test -c playwright.screenshots.config.ts  ->  docs/screenshots/*.png
export default defineConfig({
  testDir: 'tests/screenshots',
  workers: 1,
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  }],
  use: { baseURL: 'http://localhost:5197' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 5197 --strictPort',
    url: 'http://localhost:5197',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
