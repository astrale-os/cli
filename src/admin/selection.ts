import type { ClientSession } from '@astrale-os/sdk/client/session'

import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'
import { PropertyKey, K } from '@astrale-os/sdk/schema'

import { AstraleError } from '../errors'
import { mapBounded } from '../lib/concurrency'
import { AdminContract } from './contract'
import { readAllNodes, type AdminGraphQueryApi } from './graph'

/** Selection is advisory; each Admin callable still admits the live caller through its policy. */
export async function resolveAdminFleet(
  context: { fleet?: string; session: ClientSession; graph: AdminGraphQueryApi },
  creation = false,
): Promise<Path> {
  if (context.fleet !== undefined) return Path.parse(context.fleet)
  const nodes = await readAllNodes(
    context.graph,
    Query.from({ nodes: [AdminContract.classes.Fleet] }).select({
      kind: 'nodes',
      projection: { kind: 'value' },
    }),
    { label: 'Fleet directory', maximum: 10_000, maximumPages: 40 },
  )
  const auth = context.session.auth
  const slugKey = PropertyKey.of(AdminContract.classes.Fleet, 'slug')
  const fleets = await mapBounded(nodes, 8, async (node) => {
    const slug = node.props[slugKey]
    const name = node.props[K.classes.Named.properties.name.key]
    if (typeof slug !== 'string' || typeof name !== 'string')
      throw new Error('Fleet has no slug or name: migration required.')
    return {
      id: node.id,
      slug,
      name,
      usable: await auth.can({
        policy: { origin: 'admin.astrale.ai', kind: 'policy', name: 'UseFleet' },
        object: node.id,
      }),
    }
  })
  const usable = fleets.filter((fleet) => fleet.usable)
  const candidates = !creation && usable.length === 0 ? fleets : usable
  const selected = candidates.length === 1 ? candidates[0] : undefined
  if (selected !== undefined) return Path.id(selected.id)
  throw new AstraleError(
    candidates.length === 0 ? 'FLEET_UNAVAILABLE' : 'FLEET_SELECTION_REQUIRED',
    candidates.length === 0
      ? 'No Fleet is available for this operation.'
      : 'Multiple Fleets are available. Choose one for this operation.',
    candidates.length === 0
      ? 'Ask a Fleet administrator for access.'
      : `Pass --fleet with one of: ${candidates.map((fleet) => `${fleet.name} (@${fleet.id})`).join(', ')}.`,
  )
}
