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
})

test('the name is written from the left, so the caret sits before the prompt, not through it', () => {
  const html = render()
  const name = html.match(/<input[^>]*aria-label="Domain name"[^>]*>/)?.[0] ?? ''

  expect(name).not.toBe('')
  // a centred title put the caret through the middle of "domain name"; hiding the
  // caret made a click into the field look like nothing had happened
  expect(name).not.toContain('text-center')
  expect(name).not.toContain('caret-transparent')
  // and the prompt answers the focus, so the field is seen to be waiting
  expect(name).toContain('focus:placeholder:')
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
