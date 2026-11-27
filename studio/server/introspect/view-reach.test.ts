import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { DefinitionLink, IrClass, IrMethod, SchemaIR } from '../../shared/contracts/schema'

import { buildViews } from './anatomy/views'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A Domain written to a temporary directory, removed after the test or, `shared`, after all. */
function project(files: Record<string, string>, shared = false): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-view-reach-'))
  if (shared) afterAll(() => rmSync(root, { recursive: true, force: true }))
  else roots.push(root)
  // the frontend is found through the Project's Domain module
  const config = `import { defineProject } from '@astrale-os/sdk/project'
import { domain } from './domain.js'
export default defineProject({ domain })
`
  for (const [path, text] of Object.entries({ 'astrale.config.ts': config, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const method = (name: string, isStatic = false): IrMethod => ({
  name,
  input: {},
  output: { mode: 'value', schema: {} },
  static: isStatic,
  abstract: false,
  executable: true,
  auth: 'authorized',
})

const invoiceClass = (name: string, more: Partial<IrClass> = {}): IrClass => ({
  type: 'node',
  name,
  origin: 'billing.example',
  ref: { origin: 'billing.example', kind: 'class', name },
  properties: {},
  methods: {},
  ...more,
})

/** Invoices a Customer is billed for: one Function, instance, static and inherited Methods. */
const billing: SchemaIR = {
  version: 'v1',
  format: 'astrale.dsl',
  domain: 'billing.example',
  importsByKey: {},
  importedClassesByKey: {},
  classes: {
    Document: invoiceClass('Document', { methods: { archive: method('archive') } }),
    Invoice: invoiceClass('Invoice', {
      extends: ['Document'],
      methods: { approve: method('approve'), issue: method('issue', true) },
    }),
    Customer: invoiceClass('Customer'),
  },
  functions: {
    summarize: {
      name: 'summarize',
      input: {},
      output: { mode: 'value', schema: {} },
      auth: 'authorized',
    },
  },
  views: {},
  policies: {},
  dependencies: [],
  core: {},
}

/** The overlay's reading of the Domain's own Query, as the Bundle carries it. */
const openInvoices: DefinitionLink = {
  kind: 'query',
  id: 'billing.invoice.open',
  name: 'openInvoices',
  file: 'queries/open.ts',
  line: 3,
  classes: ['Invoice'],
  effects: [{ kind: 'read', class: 'Invoice', verb: 'where', file: 'queries/open.ts', line: 4 }],
}

const reach = { ir: billing, definitions: [openInvoices], dependencies: {} }

const schema = (views: string) =>
  `export const schema = defineSchema('billing.example', { name: 'Billing', views: { ${views} } })\n`

const desk = project(
  {
    'package.json': JSON.stringify({
      name: '@example/billing',
      imports: { '#queries/*': './queries/*.ts' },
    }),
    'schema/index.ts': schema('desk: view({})'),
    'domain.ts': `import { defineFrontend, vite } from '@astrale-os/sdk/domain'
export const frontend = defineFrontend({ schema, source: vite(), routes: { desk: { path: '/desk', document: 'desk.html' } } })
`,
    'desk.html': `<!doctype html><div id="root"></div><script type="module" src="/src/desk.tsx"></script>\n`,
    'queries/open.ts': `import { defineQuery } from '@astrale-os/sdk/query'

export const openInvoices = defineQuery()('billing.invoice.open', {
  build: (_, d) => d.Invoice.where((invoice) => invoice.open.is(true)).all(),
})
`,
    'src/desk.tsx': `import { useAction, useDomain, useObject, useQuery } from '@astrale-os/shell-react'
import { createRoot } from 'react-dom/client'

import { openInvoices } from '#queries/open'
import { schema } from '../schema/index.js'
import { Approve } from './approve.js'
import { customers } from './data.js'
import { usePaged } from './paged.js'

function Desk({ name }: { name: string }) {
  const domain = useDomain(schema).domain
  const open = usePaged(openInvoices)
  const known = useQuery(customers, undefined)
  const summarize = useAction(domain.functions.summarize)
  const { Invoice } = domain.classes
  const issue = useAction(Invoice.static.methods.issue)
  const named = useAction(domain.classes.Invoice.methods[name])
  const picked = useQuery(pickQuery(name), undefined)
  const customer = useObject(domain.classes.Customer, name)
  const archive = useAction(Invoice.methods.archive)
  const refund = useAction(Invoice.methods.refund)
  return <Approve />
}

createRoot(document.getElementById('root')!).render(<Desk name="draft" />)
`,
    'src/approve.tsx': `import { useAction, useDomain } from '@astrale-os/shell-react'
import { schema } from '../schema/index.js'

export function Approve() {
  const approve = useAction(useDomain(schema).domain.classes.Invoice.methods.approve)
  return null
}
`,
    'src/paged.ts': `import { useQuery } from '@astrale-os/shell-react'

export function usePaged(query) {
  return useQuery(query, undefined)
}
`,
    'src/data.ts': `import { defineQuery } from '@astrale-os/sdk/query'

export const customers = defineQuery()('billing.view.customers', {
  build: (_, d) => d.Customer.where((customer) => customer.active.is(true)).all(),
})
`,
  },
  true,
)
const [deskView] = buildViews(desk, 'schema', { desk: { name: 'desk' } }, undefined, reach)
const deskReach = deskView?.reach?.status === 'read' ? deskView.reach : undefined

test('a View reads the module scripts of its route document, through the Vite root', () => {
  expect(deskReach).toMatchObject({
    status: 'read',
    scope: 'view',
    sharedWith: [],
    entries: ['src/desk.tsx'],
  })
  // the entry, the components and hooks it imports, the Query module: not the Schema
  expect(deskReach?.files).toBe(5)
})

test('a direct Function call is named by its bundle key, where the code names it', () => {
  expect(deskReach?.calls).toContainEqual({
    key: 'summarize',
    sites: [{ file: 'src/desk.tsx', line: 14 }],
  })
})

test('a Method call is keyed by its declaring Class, through destructuring and imports', () => {
  expect(deskReach?.calls.map((call) => call.key)).toEqual([
    'Document.archive',
    'Invoice.approve',
    'Invoice.issue',
    'summarize',
  ])
  expect(deskReach?.calls).toContainEqual({
    key: 'Document.archive',
    sites: [{ file: 'src/desk.tsx', line: 20 }],
  })
  expect(deskReach?.calls).toContainEqual({
    key: 'Invoice.approve',
    sites: [{ file: 'src/approve.tsx', line: 5 }],
  })
  expect(deskReach?.calls).toContainEqual({
    key: 'Invoice.issue',
    sites: [{ file: 'src/desk.tsx', line: 16 }],
  })
})

test('a Query read names the Classes its definition reads, the overlay’s or the View’s own', () => {
  expect(deskReach?.definitions).toEqual([
    // handed to a hook through a parameter: the site is where the caller names it
    { kind: 'query', id: 'billing.invoice.open', sites: [{ file: 'src/desk.tsx', line: 12 }] },
    { kind: 'query', id: 'billing.view.customers', sites: [{ file: 'src/desk.tsx', line: 13 }] },
  ])
  expect(deskReach?.reads).toEqual([
    // and through its Class handle
    {
      class: 'Customer',
      definitions: ['billing.view.customers'],
      sites: [{ file: 'src/desk.tsx', line: 19 }],
    },
    { class: 'Invoice', definitions: ['billing.invoice.open'], sites: [] },
  ])
  expect(deskReach?.ownDefinitions).toMatchObject([
    { kind: 'query', id: 'billing.view.customers', file: 'src/data.ts', line: 3 },
  ])
})

test('a computed or undeclared call target is a gap, never a guessed call', () => {
  expect(deskReach?.gaps).toEqual([
    {
      file: 'src/desk.tsx',
      line: 17,
      reason:
        'names a callable through a key the reading cannot tell: `domain.classes.Invoice.methods[name]`',
    },
    {
      file: 'src/desk.tsx',
      line: 18,
      reason: 'calls `useQuery` with a target the reading cannot tell: `pickQuery(name)`',
    },
    {
      file: 'src/desk.tsx',
      line: 21,
      reason:
        'names `Invoice.refund`, which the Domain’s Schema does not declare: `Invoice.methods.refund`',
    },
  ])
})

test('a View no code serves states it; one whose code cannot be found is unread', () => {
  const bare = project({ 'schema/index.ts': schema('summary: view({})') })
  expect(buildViews(bare, 'schema', { summary: { name: 'summary' } }, undefined, reach)).toEqual([
    {
      slug: 'summary',
      kind: 'unknown',
      file: 'schema/index.ts',
      reach: {
        status: 'none',
        reason: 'The Domain declares no frontend: no code serves this View.',
      },
    },
  ])

  const missing = project({
    'schema/index.ts': schema('summary: view({})'),
    'domain.ts': `export const frontend = defineFrontend({ schema, source: vite() })\n`,
  })
  const [summary] = buildViews(
    missing,
    'schema',
    { summary: { name: 'summary' } },
    undefined,
    reach,
  )
  expect(summary?.reach).toEqual({
    status: 'unread',
    reason: 'The View’s document `index.html` does not exist.',
    file: 'domain.ts',
    line: 1,
  })
})

test('Views starting from one document share one reading, which says it is the frontend’s', () => {
  const root = project({
    'schema/index.ts': schema('inbox: view({}), archive: view({})'),
    'domain.ts': `export const frontend = defineFrontend({ schema, source: vite() })\n`,
    'index.html': `<script type="module" src="./src/main.ts"></script>\n`,
    'src/main.ts': `import { useAction, useDomain } from '@astrale-os/shell-react'
import { schema } from '../schema/index.js'
import * as panels from './panels.js'

const useApprove = () => useAction(useDomain(schema).domain.classes.Invoice.methods.approve)

mount(useApprove, panels)
`,
    'src/panels.ts': `import { useAction, useDomain } from '@astrale-os/shell-react'
import { schema } from '../schema/index.js'

export const useSummary = () => useAction(useDomain(schema).domain.functions.summarize)
`,
  })
  const views = buildViews(
    root,
    'schema',
    { inbox: { name: 'inbox' }, archive: { name: 'archive' } },
    undefined,
    reach,
  )
  expect(views.map((view) => [view.slug, view.reach])).toEqual([
    [
      'inbox',
      expect.objectContaining({
        status: 'read',
        scope: 'frontend',
        sharedWith: ['archive'],
        calls: [
          { key: 'Invoice.approve', sites: [{ file: 'src/main.ts', line: 5 }] },
          { key: 'summarize', sites: [{ file: 'src/panels.ts', line: 4 }] },
        ],
        // a namespace handed on whole reaches all its module declares: the reading says so
        gaps: [
          {
            file: 'src/main.ts',
            line: 7,
            reason:
              'uses the namespace `panels` whole: the reading counts everything its module declares as reached',
          },
        ],
      }),
    ],
    [
      'archive',
      expect.objectContaining({ status: 'read', scope: 'frontend', sharedWith: ['inbox'] }),
    ],
  ])
})

test('Views carry no reach without a reach context', () => {
  expect(buildViews(desk, 'schema', { desk: { name: 'desk' } })[0]).not.toHaveProperty('reach')
})
