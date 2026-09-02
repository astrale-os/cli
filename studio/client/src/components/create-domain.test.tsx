import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { NewDomainCard } from './create-domain'

function render(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NewDomainCard onClose={() => {}} />
    </QueryClientProvider>,
  )
}

test('a new domain is a name and the same composer the agent has everywhere else', () => {
  const html = render()

  expect(html).toContain('aria-label="Domain name"')
  // the name IS the heading — nothing labels it, and nothing is said under it
  expect(html).not.toContain('NEW DOMAIN')
  expect(html).not.toContain('origin')
  // the field, the clip and the send button — the composer, before the domain exists
  expect(html).toContain('data-new-domain-composer')
  expect(html).toContain('aria-label="Attach a document"')
  expect(html).toContain('aria-label="Create the domain"')
})

test('it carries no comment threads: a domain that does not exist has none', () => {
  const html = render()

  expect(html).not.toContain('comment')
  expect(html).not.toContain('Comments')
})

test('an empty name has nothing to correct, and nothing to send', () => {
  const html = render()

  expect(html).not.toContain('lowercase')
  expect(html).toContain('disabled=""')
  // a centred empty field would draw the caret THROUGH the prompt it shows
  expect(html).toContain('caret-transparent')
})

test('at rest it explains nothing: a name and a message are their own instructions', () => {
  const html = render()

  // the status line is mounted — its height is held, so the card does not move
  // when the send begins — and it is empty until one does
  expect(html).toContain('aria-live="polite"')
  expect(html).not.toContain('Creating')
  expect(html).not.toContain('agent picks the message up')
  // the one spinner belongs to the send button, and nothing is spinning yet
  expect(html).not.toContain('animate-spin')
})
