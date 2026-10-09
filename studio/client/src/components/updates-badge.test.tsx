import type { StaleReport } from '@shared/types'

import { expect, test } from 'bun:test'

import { packageUpdatePrompt, packageUpdateSummary } from './updates-badge'

const report: StaleReport = {
  stale: true,
  cli: { stale: false, managed: true },
  skills: { status: 'current' },
  sdk: {
    stale: true,
    inProject: true,
    outdated: [
      { pkg: '@astrale-os/sdk', current: '0.5.0-beta.106', latest: '0.5.0-beta.107' },
      { pkg: '@astrale-os/ui', current: '0.4.0', latest: '0.5.0' },
    ],
  },
}

test('the quiet package hint names every exact upgrade', () => {
  expect(packageUpdateSummary(report)).toBe(
    '@astrale-os/sdk 0.5.0-beta.106 → 0.5.0-beta.107 · @astrale-os/ui 0.4.0 → 0.5.0',
  )
})

test('the prepared agent message is exact, scoped, and remains an instruction rather than a command', () => {
  const prompt = packageUpdatePrompt('billing.example.com', report)

  expect(prompt).toContain('billing.example.com domain')
  expect(prompt).toContain('- @astrale-os/sdk: 0.5.0-beta.106 → 0.5.0-beta.107')
  expect(prompt).toContain('- @astrale-os/ui: 0.4.0 → 0.5.0')
  expect(prompt).toContain("run the domain's checks")
  expect(prompt).toContain('Do not change unrelated packages')
  expect(prompt).not.toContain('astrale update')
})
