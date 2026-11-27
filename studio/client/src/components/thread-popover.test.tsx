import { publishedDomainId } from '@shared/contracts/versions'
import { KERNEL_DOMAIN_ID } from '@shared/contracts/workspace'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ThreadPopover } from './thread-popover'

function popover(domainId: string): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ThreadPopover
        domainId={domainId}
        anchor={{ ref: 'class.Payout', kind: 'schema' }}
        excerpt="Payout"
        threads={[]}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
}

test('a read-only Domain’s comment popover says so where the composer would be', () => {
  for (const domainId of [publishedDomainId('payments.example.dev', '1.1.0'), KERNEL_DOMAIN_ID]) {
    const html = popover(domainId)
    expect(html).toContain('data-read-only-notice')
    expect(html).toContain('is read-only')
    expect(html).not.toContain('<textarea')
  }
  const own = popover('crm-1a2b3c4d')
  expect(own).not.toContain('data-read-only-notice')
  expect(own).toContain('<textarea')
})
