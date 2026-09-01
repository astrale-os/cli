import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.STUDIO_E2E_PORT ?? 4397)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // The suite writes node positions, visibility and comment threads into the
  // fixture, so it is not idempotent on its own. Clear those before each run —
  // here rather than in the server, which `reuseExistingServer` may not restart.
  globalSetup: './e2e/reset-state.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun e2e/server.ts',
    url: `${baseURL}/api/workspace`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { STUDIO_E2E_PORT: String(port) },
  },
})
