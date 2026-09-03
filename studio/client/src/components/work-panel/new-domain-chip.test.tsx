import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { NewDomainChip } from './new-domain-chip'

test('names the freshly scaffolded domain and frames the chat as its creation brief', () => {
  const html = renderToStaticMarkup(
    <NewDomainChip domain={{ id: 'billing', origin: 'billing.example.dev', path: './billing' }} />,
  )

  expect(html).toContain('data-testid="new-domain-context"')
  expect(html).toContain('New domain')
  expect(html).toContain('billing.example.dev')
  expect(html).toContain('./billing')
  expect(html).toContain('This chat is its creation brief')
})
