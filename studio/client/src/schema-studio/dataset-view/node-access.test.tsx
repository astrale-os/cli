import type { IrMethod } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { indexPolicies } from '@/lib/policy'

import { bundle, nodeClass } from '../__tests__/fixture'
import { NodeAccess } from './node-access'

test('node access exposes implemented contracts, not contract-only or static Methods', () => {
  const method = (name: string, executable: boolean, static_ = false): IrMethod => ({
    name,
    executable,
    static: static_,
    abstract: true,
    input: { type: 'string' },
    output: { mode: 'value', schema: { type: 'boolean' } },
  })
  const fixture = bundle({
    Invoice: nodeClass('Invoice', {
      methods: {
        settle: method('settle', true),
        pending: method('pending', false),
        create: method('create', true, true),
      },
    }),
  })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NodeAccess
        bundle={fixture}
        node={{ path: '@invoice', className: 'Invoice', data: {} }}
        index={indexPolicies(fixture.ir!)}
        onProbe={() => {}}
      />
    </QueryClientProvider>,
  )
  expect(html).toContain('>settle<')
  expect(html).not.toContain('>pending<')
  expect(html).not.toContain('>create<')
})
