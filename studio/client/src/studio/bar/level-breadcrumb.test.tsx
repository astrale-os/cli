import type { StudioDatasets } from '@shared/contracts/schema'
import type { DomainSummary } from '@shared/contracts/workspace'

import { KERNEL_DOMAIN_ID } from '@shared/contracts/workspace'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { LevelBreadcrumb } from './level-breadcrumb'

const DESK: DomainSummary = {
  id: 'desk-0a1b2c3d',
  origin: 'desk.example.dev',
  path: '/work/desk',
  schemaDir: 'schema',
  depsInstalled: true,
  hasGit: false,
  configFile: '/work/desk/astrale.config.ts',
}
const KERNEL: DomainSummary = { ...DESK, id: KERNEL_DOMAIN_ID, origin: 'kernel.astrale.ai' }

const SUPPORT: StudioDatasets['datasets'][number] = {
  status: 'failed',
  path: './tests/datasets/support.ts',
  error: { message: 'Dataset module not found' },
}

/**
 * The dataset crumb's button as it shows on a Domain's Schema before its menu opens, the Domain's
 * datasets known.
 */
function crumb(domain: DomainSummary, datasets: StudioDatasets['datasets']): string {
  const client = new QueryClient()
  client.setQueryData(qk.datasets(domain.id), {
    domainId: domain.id,
    datasets,
    extractedAt: '',
  } satisfies StudioDatasets)
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LevelBreadcrumb domains={[domain]} domainId={domain.id} onDomainChange={() => {}} />
    </QueryClientProvider>,
  )
  const button = /<button[^>]*data-testid="level-dataset"[^>]*>.*?<\/button>/.exec(html)?.[0]
  expect(button).toBeDefined()
  return button!
}

test('a Domain with no Dataset says on the crumb, quietly, that the agent can be asked for one', () => {
  const html = crumb(DESK, [])
  expect(html).toContain('data-hint="ask-dataset"')
  expect(html).toContain('title="No Dataset referenced: the agent can be asked to write one"')
  expect(html).toContain('lucide-sparkles')
  expect(html).toContain('>No dataset<')
})

test('a Domain that references a Dataset, even one it cannot read, counts them and shows no hint', () => {
  const html = crumb(DESK, [SUPPORT])
  expect(html).not.toContain('data-hint')
  expect(html).not.toContain('lucide-sparkles')
  expect(html).toContain('title="Open a dataset"')
  expect(html).toContain('>1 dataset<')
  expect(html).not.toContain('No dataset')
})

test('a Domain the Studio only reads is told it has no Dataset, and offered no request', () => {
  const html = crumb(KERNEL, [])
  expect(html).not.toContain('data-hint')
  expect(html).not.toContain('lucide-sparkles')
  expect(html).toContain('title="No Dataset referenced"')
})
