import type { IrMethod } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { bundle, classRef, nodeClass } from '../__tests__/fixture'
import { SchemaDetail } from './panel'

const method = (name: string, input: IrMethod['input'] = { type: 'object' }): IrMethod => ({
  name,
  input,
  output: { mode: 'value', schema: { type: 'boolean' } },
  static: false,
  inheritance: 'default',
})

const identity = classRef('kernel.astrale.ai', 'Identity')
const fixture = bundle({
  Document: nodeClass('Document', {
    extendsRefs: [identity],
    properties: { reference: { type: 'string' } },
    required: ['reference'],
    methods: { archive: method('archive') },
  }),
  Invoice: nodeClass('Invoice', {
    description: 'An invoice contract.',
    extendsRefs: [classRef('local.example.dev', 'Document')],
    properties: { total: { type: 'number' } },
    required: ['total'],
    methods: {
      settle: method('settle', {
        type: 'object',
        properties: { amount: { type: 'number' }, note: { type: 'string' } },
        required: ['amount'],
      }),
      search: { ...method('search'), static: true },
    },
  }),
})
fixture.ir!.importedClassesByKey = {
  'kernel.astrale.ai:class.Identity': nodeClass('Identity', {
    origin: identity.origin,
    ref: identity,
    properties: { sub: { type: 'string' } },
    required: ['sub'],
  }),
}

function render(selected: string): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDetail bundle={fixture} selected={selected} />
    </QueryClientProvider>,
  )
}

describe('the Class detail panel', () => {
  test('lists own members first and inherited ones after, named by their Class', () => {
    const html = render('class.Invoice')
    const at = (ref: string) => html.indexOf(`data-anchor-ref="${ref}"`)
    expect(at('class.Invoice.property.total')).toBeGreaterThan(-1)
    expect(at('class.Invoice.property.total')).toBeLessThan(at('class.Document.property.reference'))
    expect(at('class.Document.property.reference')).toBeLessThan(
      at('class.kernel.astrale.ai:class.Identity.property.sub'),
    )
    expect(at('class.Invoice.method.settle')).toBeLessThan(at('class.Document.method.archive'))
    // `Document.reference`, the base named in front of the member
    expect(html).toContain('Document.</span>reference')
    expect(html).not.toContain('>Inherited<')
  })

  test('clamps the Class description to three lines by default', () => {
    const html = render('class.Invoice')
    const descriptionAt = html.indexOf('An invoice contract.')
    expect(descriptionAt).toBeGreaterThan(-1)
    const descriptionMarkup = html.slice(descriptionAt - 300, descriptionAt)
    expect(descriptionMarkup).toContain('italic')
    expect(descriptionMarkup).toContain('line-clamp-3')
  })

  test('a closed method shows only its name and static status', () => {
    const html = render('class.Invoice')
    expect(html).toContain('settle</span>')
    expect(html).toContain('search</span><span class="inline-flex')
    expect(html).toContain('>static</span>')
    // no inputs, no return, no Policy on the closed line
    expect(html).not.toContain('amount')
    expect(html).not.toContain('Yes / no')
    expect(html).not.toContain('Authorized')
    expect(html).not.toContain('data-method-detail')
  })

  test('shows the whole chain as chips, the relation on hover rather than in a word', () => {
    const html = render('class.Invoice')
    expect(html).not.toContain('>extends<')
    const ancestry = html.slice(html.indexOf('data-class-ancestry'), html.indexOf('</header>'))
    expect(ancestry.indexOf('Document')).toBeLessThan(ancestry.indexOf('Identity'))
    // where a base comes from is on the hover, never on the chip
    expect(ancestry).not.toContain('· kernel')
    expect(ancestry).toContain('title="Invoice extends Document"')
    expect(ancestry).toContain(
      'title="Invoice inherits Identity (kernel.astrale.ai) through its bases"',
    )
    // a root Class has no line at all
    expect(render('class.kernel.astrale.ai:class.Identity')).not.toContain('data-class-ancestry')
  })
})
