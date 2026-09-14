import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { type QueryAST } from '@astrale-os/sdk/query'
import { expect, mock, test } from 'bun:test'

import { listAdminDomainsInContext } from '../../lib/admin-domain'
import { AdminContract } from '../contract'
import { resourceFleet } from '../resource-fleet'

const fleet = {
  id: NodeId('astrale-fleet'),
  class: ClassKey.of(AdminContract.classes.Fleet),
  props: normalizeProperties({}),
}
const result = (nodes: ReadonlyArray<typeof fleet>) => ({
  result: { kind: 'nodes', nodes: nodes.map((value) => ({ kind: 'value', value })) },
  page: {},
})

test.each([{ nodes: [] }, { nodes: [fleet, { ...fleet, id: NodeId('other-fleet') }] }])(
  'rejects missing or ambiguous containment without choosing a default',
  async ({ nodes }) => {
    const query = mock(async () => result(nodes))
    await expect(resourceFleet({ graph: { query } } as never, '@instance')).rejects.toThrow(
      'exactly one visible Fleet',
    )
    expect(query).toHaveBeenCalledTimes(1)
  },
)
test('installs from the exact Instance Fleet catalogue without any Fleet directory call', async () => {
  const observed: QueryAST[] = []
  const query = mock(async (ast: QueryAST) => {
    observed.push(ast)
    return result(observed.length === 1 ? [fleet] : [])
  })
  const neighbors = mock(async () => ({
    nodes: [],
    cursor: null,
    collect: async () => ({ nodes: [], cursor: null }),
  }))
  const call = mock(async () => {
    throw new Error('Unexpected Fleet directory call')
  })
  await expect(
    listAdminDomainsInContext(
      { graph: { query, neighbors }, session: { call } } as never,
      '@instance',
    ),
  ).resolves.toEqual([])
  expect(observed[0]?.source).toMatchObject({ terms: [{ kind: 'path', path: '@instance' }] })
  expect(observed[0]?.steps[0]).toMatchObject({
    op: 'expand',
    direction: 'incoming',
    via: [AdminContract.edges.fleetContains],
  })
  expect(observed[1]?.source).toMatchObject({ terms: [{ kind: 'path', path: '@astrale-fleet' }] })
  expect(call).not.toHaveBeenCalled()
})
