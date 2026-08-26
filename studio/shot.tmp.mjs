// Isolated headless screenshotter for the studio — never touches the user's browser.
import { chromium } from '@playwright/test'

const [, , out, ...steps] = process.argv
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:4403/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
for (const step of steps) {
  if (step.startsWith('wait:')) {
    await page.waitForTimeout(Number(step.slice(5)))
    continue
  }
  await page.evaluate(step)
  await page.waitForTimeout(1200)
}
await page.screenshot({ path: out })
const url = page.url()
await browser.close()
console.log('saved', out, url)
