import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  workers: 1,
  use: {
    browserName: 'chromium',
    launchOptions: { ignoreDefaultArgs: ['--disable-popup-blocking'] },
    trace: 'retain-on-failure',
  },
})
