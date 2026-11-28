import type { StudioDatasets } from '@shared/contracts/schema'
import type { DomainSummary } from '@shared/contracts/workspace'

import { KERNEL_DOMAIN_ID } from '@shared/contracts/workspace'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipProvider } from '@/components/ui/tooltip'
import { qk } from '@/lib/api'

import { LevelSwitch } from './level-switch'

const DESK = { id: 'desk-0a1b2c3d', origin: 'desk.example.dev' } satisfies Pick<
  DomainSummary,
  'id' | 'origin'
>
const KERNEL = { id: KERNEL_DOMAIN_ID, origin: 'kernel.astrale.ai' }

const SUPPORT: StudioDatasets['datasets'][number] = {
  status: 'failed',
  path: './tests/datasets/support.ts',
  error: { message: 'Dataset module not found' },
}

/** The switch's two segments as they show at `level`, the Domain's datasets known. */
function segments(
  level: 'schema' | 'data',
  {
    domain = DESK,
    datasets = [SUPPORT],
    publication = false,
  }: {
    domain?: Pick<DomainSummary, 'id' | 'origin'>
    datasets?: StudioDatasets['datasets']
    publication?: boolean
  } = {},
): { group: string; schema: string; data: string } {
  const client = new QueryClient()
  client.setQueryData(qk.datasets(domain.id), {
    domainId: domain.id,
    datasets,
    extractedAt: '',
  } satisfies StudioDatasets)
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LevelSwitch domain={domain} dataLevel={level === 'data'} publication={publication} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  const segment = (name: string) =>
    new RegExp(`<button[^>]*data-level="${name}"[^>]*>.*?</button>`).exec(html)?.[0]
  const group = /<div[^>]*data-testid="level-switch"[^>]*>/.exec(html)?.[0]
  const [schema, data] = [segment('schema'), segment('data')]
  expect([group, schema, data].every((part) => part !== undefined)).toBe(true)
  return { group: group!, schema: schema!, data: data! }
}

test('at the Schema level, Schema is the segment in use and Data is offered by its glyph', () => {
  const { group, schema, data } = segments('schema')
  expect(group).toContain('data-level="schema"')
  expect(group).toContain('aria-label="Level"')
  expect(schema).toContain('aria-pressed="true"')
  expect(schema).toContain('>Schema<')
  expect(schema).not.toContain('bg-primary')
  expect(data).toContain('aria-pressed="false"')
  expect(data).not.toContain('disabled=""')
  expect(data).toContain('lucide-database')
  // narrow, the segment not in use keeps its name for assistive technology only
  expect(data).toContain('class="max-lg:sr-only">Data<')
})

test('at the Data level, Data is the segment in use and wears the Data accent', () => {
  const { group, schema, data } = segments('data')
  expect(group).toContain('data-level="data"')
  expect(data).toContain('aria-pressed="true"')
  expect(data).toContain('bg-primary text-primary-foreground')
  expect(data).toContain('<span>Data</span>')
  expect(schema).toContain('aria-pressed="false"')
  expect(schema).toContain('class="max-lg:sr-only">Schema<')
})

test('a Publication carries no dataset: its Data segment is disabled', () => {
  const { schema, data } = segments('schema', { publication: true, datasets: [] })
  expect(schema).toContain('aria-pressed="true"')
  expect(data).toContain('disabled=""')
  expect(data).not.toContain('data-hint')
})

test('a Domain with no Dataset says on the Data segment, quietly, that the agent can be asked for one', () => {
  const { data } = segments('schema', { datasets: [] })
  expect(data).toContain('data-hint="ask-dataset"')
  expect(data).toContain('aria-label="No Dataset referenced: the agent can be asked to write one"')
  expect(data).toContain('lucide-sparkles')
  // the hint names no action: Data stays the way to the Datasets page
  expect(data).not.toContain('disabled=""')
})

test('a Domain that references a Dataset, even one it cannot read, shows no hint', () => {
  const { data } = segments('schema', { datasets: [SUPPORT] })
  expect(data).not.toContain('data-hint')
  expect(data).not.toContain('lucide-sparkles')
})

test('a Domain the Studio only reads is offered no request', () => {
  const { data } = segments('schema', { domain: KERNEL, datasets: [] })
  expect(data).not.toContain('data-hint')
  expect(data).not.toContain('lucide-sparkles')
})
