import { call, type Input } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'
import { z } from 'zod'

import type { AdminInstanceContext } from '../instance/client'

import { AdminContract } from '../contract'
import { readAllNodes } from '../graph'

const fleetSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  canUse: z.boolean(),
  canAdminister: z.boolean(),
})
export type FleetInfo = z.infer<typeof fleetSchema>
export async function listFleets(context: AdminInstanceContext): Promise<FleetInfo[]> {
  return z.array(fleetSchema).parse(await invokeFleet(context, 'list', {}))
}
export async function createFleet(
  context: AdminInstanceContext,
  input: {
    operationId: string
    slug: string
    name: string
    administrator: string
    copyFrom: string
  },
): Promise<FleetInfo> {
  const copyFrom = await resolveFleet(context, input.copyFrom)
  return fleetSchema.parse(
    await invokeFleet(context, 'create', {
      ...input,
      administrator: Path.parse(input.administrator).raw,
      copyFrom: copyFrom.raw,
    }),
  )
}
function invokeFleet(context: AdminInstanceContext, method: string, input: Input) {
  return context.session.call(
    call(Path.staticMethod(Path.project(AdminContract.classes.Fleet), method), input),
  )
}
/** Omission is the documented default. An explicit unknown selection never falls back. */
export async function resolveFleet(
  context: AdminInstanceContext,
  selection?: string,
): Promise<Path> {
  if (selection === undefined || selection === 'default') return AdminContract.fleet
  const found = (await listFleets(context)).filter(
    (fleet) =>
      fleet.slug === selection || fleet.id === selection || fleet.id.slice(1) === selection,
  )
  if (found.length !== 1)
    throw new Error(`Fleet ${JSON.stringify(selection)} is unavailable or ambiguous.`)
  return Path.parse(found[0]!.id)
}
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
