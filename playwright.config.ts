import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:5198' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 5198 --strictPort',
    url: 'http://localhost:5198',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
