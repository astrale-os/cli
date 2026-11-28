import type { StudioDataset, StudioDatasetFailure } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { DatasetsView, holdingsOf, standingOf } from './datasets-page'

const ORIGIN = 'desk.example.dev'

/** Two people, the ticket one raised, and the Domain it belongs to: three Nodes, two Classes. */
const desk: StudioDataset = {
  status: 'ready',
  path: './tests/datasets/desk.ts',
  id: 'desk',
  title: 'Help desk',
  description: 'Two people and the ticket one of them raised.',
  origin: ORIGIN,
  revision: 'sha256:0123456789abcdef',
  schemaMatch: true,
  references: {},
  nodes: [
    { path: 'ann', className: 'Person', data: { name: 'Ann' } },
    { path: 'bob', className: 'Person', data: { name: 'Bob' } },
    { path: 'printer', className: 'Ticket', data: { subject: 'Printer jams' } },
  ],
  edges: [{ from: 'ann', to: 'printer', edgeName: 'raised' }],
  variables: { ann: ['ann'] },
}
const stale: StudioDataset = { ...desk, path: './tests/datasets/stale.ts', schemaMatch: false }
const broken: StudioDatasetFailure = {
  status: 'failed',
  path: './tests/datasets/broken.ts',
  error: { message: 'Dataset edge source nobody is not a Node of this Dataset.' },
}

const page = (props: Partial<Parameters<typeof DatasetsView>[0]>) =>
  renderToStaticMarkup(<DatasetsView origin={ORIGIN} onOpen={() => {}} {...props} />)

/** Each card's markup, by the module it names. */
function cards(html: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [card, path] of html.matchAll(/<div [^>]*data-dataset-card="([^"]+)".*?<\/li>/g))
    found.set(path!, card)
  return found
}

test('a Domain with no Dataset is told what one is, where it is declared, and offered the request', () => {
  const html = page({ entries: [], onAsk: () => {} })
  expect(html).toContain('data-testid="datasets-page" data-state="none"')
  expect(html).toContain('No Dataset referenced')
  expect(html).toContain(
    'A Dataset is a small graph of Nodes and Edges, written in code, that the Data level asks through Queries and decides access on.',
  )
  // the two lines that declare one: the module, and the line of the configuration that lists it
  expect(html).toContain('tests/datasets/&lt;name&gt;.ts')
  expect(html).toContain('export default defineDataset(schema, { id, title, graph })')
  expect(html).toContain('astrale.config.ts')
  expect(html).toContain(
    'tests: tests({ datasets: [dataset(&#x27;./tests/datasets/&lt;name&gt;.ts&#x27;)] })',
  )
  expect(html).toContain('@astrale-os/sdk/testing')
  expect(html).toContain('data-action="ask-dataset"')
  expect(cards(html).size).toBe(0)

  // a Domain the Studio only reads is told the same, and offered nothing to write into it
  const readOnly = page({ entries: [] })
  expect(readOnly).toContain('No Dataset referenced')
  expect(readOnly).not.toContain('data-action="ask-dataset"')
})

test('each Dataset is a card: its title, module, what it holds and how it stands, to open', () => {
  const html = page({ entries: [desk, stale] })
  expect(html).toContain('data-state="some"')
  expect(html).toContain(
    'This Domain references 2 Datasets: open one to query it and read who may access what.',
  )
  expect(html).not.toContain('data-action="ask-dataset"')
  const listed = cards(html)
  expect([...listed.keys()]).toEqual([desk.path, stale.path])

  const admitted = listed.get(desk.path)!
  expect(admitted).toContain('data-standing="admitted"')
  expect(admitted).toContain('Help desk')
  expect(admitted).toContain('Two people and the ticket one of them raised.')
  expect(admitted).toContain('data-action="open-dataset"')
  expect(admitted).toContain('Admitted against this Schema (revision 01234567).')
  const holdings = /data-dataset-holdings=""[^>]*>(.*?)<\/p>/
    .exec(admitted)![1]!
    .replace(/<[^>]+>/g, '')
  expect(holdings).toBe('3 Nodes1 Edge2 Classes')

  const other = listed.get(stale.path)!
  expect(other).toContain('data-standing="other-revision"')
  expect(other).toContain('Admitted against another Schema revision')
})

test('a Dataset that could not be read keeps its card, says why, and still opens', () => {
  const html = page({ entries: [desk, broken], onAsk: () => {} })
  expect(html).toContain('data-state="some"')
  // a Domain that references a Dataset is offered no request to write one, even an unreadable one
  expect(html).not.toContain('data-action="ask-dataset"')
  const unreadable = cards(html).get(broken.path)!
  expect(unreadable).toContain('data-standing="unreadable"')
  // named by its module, since it has no title to show
  expect(unreadable).toContain('>broken</button>')
  expect(unreadable).toContain('Could not be read, so it holds no Node to draw.')
  expect(unreadable).toContain('<pre data-dataset-reason=""')
  expect(unreadable).toContain('Dataset edge source nobody is not a Node of this Dataset.')
  expect(unreadable).toContain('data-action="open-dataset"')
  expect(unreadable).not.toContain('data-dataset-holdings')
})

test('datasets that could not be extracted say why, instead of listing none', () => {
  const html = page({ failure: 'the project configuration could not be read' })
  expect(html).toContain('data-state="error"')
  expect(html).toContain('The datasets could not be extracted')
  expect(html).toContain('the project configuration could not be read')
  expect(html).not.toContain('No Dataset referenced')
})

test('a standing and a count read from the Dataset alone', () => {
  expect(standingOf(desk)).toBe('admitted')
  expect(standingOf(stale)).toBe('other-revision')
  expect(standingOf(broken)).toBe('unreadable')
  // identities are counted once the Domain's rules can say which Classes are identities
  expect(holdingsOf(desk)).toEqual({ nodes: 3, edges: 1, classes: 2 })
})
