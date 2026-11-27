import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Reading } from './remote'

const what = 'the Publications of shell.astrale.ai'

test('a read still within its limit says what it reads, and nothing of a limit', () => {
  const html = renderToStaticMarkup(
    <Reading limitMs={60_000} what={what} onRetry={() => {}}>
      Reading the Publications of shell.astrale.ai…
    </Reading>,
  )
  expect(html).toContain('data-workspace-reading')
  expect(html).toContain('Reading the Publications of shell.astrale.ai…')
  expect(html).not.toContain('data-remote-status')
})

test('a read past its limit says the limit it hit and offers the read again', () => {
  const html = renderToStaticMarkup(
    <Reading limitMs={0} what={what} onRetry={() => {}}>
      Reading the Publications of shell.astrale.ai…
    </Reading>,
  )
  expect(html).toContain('data-remote-status="overdue"')
  expect(html).toContain(
    'No answer for the Publications of shell.astrale.ai in 0 s, the longest a registry read is given.',
  )
  expect(html).toContain('an index read 1 min, a bundle download 2 min, a judgement 3 min')
  expect(html).toContain('data-workspace-retry')
  expect(html).not.toContain('data-workspace-reading')
})

test('a read given no limit only says what it reads', () => {
  const html = renderToStaticMarkup(<Reading>Reading the registry's Domains…</Reading>)
  expect(html).toContain('Reading the registry&#x27;s Domains…')
  expect(html).not.toContain('data-reading-elapsed')
  expect(html).not.toContain('data-remote-status')
})
