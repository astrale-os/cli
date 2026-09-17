import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'

import type { AdminInstanceContext } from './instance/client'

import { AdminContract } from './contract'
import { readAllNodes } from './graph'

export async function resourceFleet(
  context: AdminInstanceContext,
  resource: string,
): Promise<Path> {
  const nodes = await readAllNodes(
    context.graph,
    Query.from({ nodes: [Path.parse(resource)] })
      .expand({ via: [AdminContract.edges.fleetContains], direction: 'incoming' })
      .filter({ class: AdminContract.classes.Fleet })
      .select({ kind: 'nodes', projection: { kind: 'value' } }),
    { label: 'Resource Fleet', maximum: 2, maximumPages: 1 },
  )
  if (nodes.length !== 1) throw new Error('Resource must belong to exactly one visible Fleet.')
  return Path.id(nodes[0]!.id)
}
