import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ErrorBanner } from './error-banner'

const LONG =
  '/classes/principal_administers_company/policies/read [PL_USE] organization.astrale.ai:policy.ObserveCompanyRole is not valid for every concrete source/target pair of read Edge Class principal_administers_company.'

test('nothing to report renders nothing at all — no empty strip above the canvas', () => {
  expect(renderToStaticMarkup(<ErrorBanner messages={[]} />)).toBe('')
  expect(renderToStaticMarkup(<ErrorBanner messages={['', '   ']} />)).toBe('')
})

test('the banner is one line tall and truncates, whatever the diagnostic carries', () => {
  const html = renderToStaticMarkup(<ErrorBanner messages={[LONG]} />)

  expect(html).toContain('h-9')
  expect(html).toContain('truncate')
  // a fixed-height row cannot be pushed open by a wrapping message
  expect(html).not.toContain('items-start')
})

test('several diagnostics stay one line: the first shows, the rest hide behind a count', () => {
  const html = renderToStaticMarkup(<ErrorBanner messages={[LONG, LONG, LONG]} />)

  expect(html).toContain('+2')
  // the trailing messages are not painted into the strip
  expect(html.match(/is not valid for every concrete/g)).toHaveLength(1)
})

test('the full text is reachable — the strip itself opens the modal, and Details says so', () => {
  const html = renderToStaticMarkup(<ErrorBanner messages={[LONG]} />)

  expect(html).toContain('Read the full message')
  expect(html).toContain('Details')
})
