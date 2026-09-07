import type { StaleReport } from '@shared/types'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { actionable, updateCommand, UpdateInstructions } from './updates-badge'

const report: StaleReport = {
  stale: true,
  cli: {
    stale: true,
    managed: false,
    current: '1.0.0-beta.77',
    latest: '1.0.0-beta.78',
    channel: 'beta',
  },
  skills: { status: 'update-available' },
  sdk: {
    stale: true,
    inProject: true,
    outdated: [{ pkg: '@astrale-os/sdk', current: '0.5.0-beta.106', latest: '0.5.0-beta.107' }],
  },
}

test('the terminal update command enters the exact domain and materializes stale SDK deps', () => {
  expect(updateCommand("/work/Marc's domain", report)).toBe(
    `cd '/work/Marc'"'"'s domain' && astrale update && pnpm install`,
  )
  expect(
    updateCommand('/work/domain', {
      ...report,
      sdk: { stale: false, inProject: true, outdated: [] },
    }),
  ).toBe(`cd '/work/domain' && astrale update`)
})

test('the update instructions make the stop-update-relaunch boundary explicit', () => {
  const html = renderToStaticMarkup(
    <UpdateInstructions report={report} domainPath="/work/domain with spaces" />,
  )

  expect(html).toContain('Astrale CLI')
  expect(html).toContain('@astrale-os/sdk')
  expect(html).toContain('astrale update &amp;&amp; pnpm install')
  expect(html).toContain('Ctrl-C')
  expect(html).toContain('relaunch your previous')
  expect(html).toContain('aria-label="Copy update command"')
  expect(html).not.toContain('Update now')
})

test('an externally managed CLI alone is not presented as an actionable update', () => {
  expect(
    actionable({
      stale: true,
      cli: { stale: true, managed: true },
      skills: { status: 'current' },
      sdk: { stale: false, inProject: false, outdated: [] },
    }),
  ).toBe(false)
})
