import type { IrClassRef, IrEndpoint, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { classRefKey, isIrClassRef } from '@shared/schema/identity'

export interface ExternalMember {
  name: string
  ref: IrClassRef
  /** A relationship reaches it — as opposed to being imported and used somewhere else. */
  connected?: boolean
}

export interface ExternalDomain {
  origin: string
  kind: 'kernel' | 'external'
  members: ExternalMember[]
}

export interface CrossDomainEdge {
  edge: string
  from: string
  origin: string
  to: string
  fromRef?: IrClassRef
  toRef: IrClassRef
  fromCard?: IrEndpoint['cardinality']
  toCard?: IrEndpoint['cardinality']
}

function endpointClasses(endpoint: Pick<IrEndpoint, 'types' | 'refs'> | undefined): Array<{
  name: string
  ref?: IrClassRef
}> {
  if (!endpoint) return []
  if (endpoint.refs !== undefined) {
    return endpoint.refs.filter(isIrClassRef).map((ref) => ({ name: ref.name, ref }))
  }
  return endpoint.types.map((name) => ({ name }))
}

export interface LocalEndpointTarget {
  className: string
}

export function localEndpointTargets(
  ir: SchemaIR,
  endpoint: Pick<IrEndpoint, 'types' | 'refs'> | undefined,
): LocalEndpointTarget[] {
  const names = endpointClasses(endpoint).flatMap(({ name, ref }) =>
    (ref === undefined || ref.origin === ir.domain) && ir.classes[name]?.type === 'node'
      ? [name]
      : [],
  )
  return [...new Set(names)].map((className) => ({ className }))
}

export function crossDomainEdges(bundle: StudioSchemaBundle): CrossDomainEdge[] {
  const ir = bundle.ir
  if (!ir) return []
  const result: CrossDomainEdge[] = []
  for (const [edgeName, edge] of Object.entries(ir.classes)) {
    if (edge.type !== 'edge' || !edge.endpoints) continue
    const source = edge.endpoints[0]
    const target = edge.endpoints[1]
    if (!source || !target) continue
    for (const [localEndpoint, externalEndpoint] of [
      [source, target],
      [target, source],
    ] as const) {
      const local = endpointClasses(localEndpoint).filter(
        ({ name, ref }) =>
          (ref === undefined || ref.origin === ir.domain) && ir.classes[name]?.type === 'node',
      )
      const external = endpointClasses(externalEndpoint).flatMap(({ name, ref }) => {
        if (ref === undefined || ref.origin === ir.domain) return []
        const descriptor = ir.importsByKey[classRefKey(ref)]
        return descriptor === undefined ? [] : [{ name, ref: descriptor.ref }]
      })
      for (const remote of external) {
        for (const owner of local) {
          result.push({
            edge: edgeName,
            from: owner.name,
            origin: remote.ref.origin,
            to: remote.name,
            ...(owner.ref === undefined ? {} : { fromRef: owner.ref }),
            toRef: remote.ref,
            fromCard: localEndpoint.cardinality,
            toCard: externalEndpoint.cardinality,
          })
        }
      }
    }
  }
  return result
}

/**
 * Every domain this one depends on, and what of it it depends on.
 *
 * Not just the far ends of relationships: `importsByKey` is the footprint the DSL resolved
 * as reachable — Classes named in properties, in policies, in Views, in Core — so a domain
 * imported without a single edge to it is a dependency all the same, and used to appear
 * nowhere in the studio at all. The ones a relationship reaches are marked, because those
 * are the ones the canvas draws a line to.
 */
export function externalDomains(bundle: StudioSchemaBundle): ExternalDomain[] {
  const ir = bundle.ir
  if (!ir) return []
  const byOrigin = new Map<string, Map<string, ExternalMember>>()
  const remember = (origin: string, member: ExternalMember) => {
    const members = byOrigin.get(origin) ?? new Map<string, ExternalMember>()
    const key = classRefKey(member.ref)
    members.set(key, { ...member, connected: members.get(key)?.connected || member.connected })
    byOrigin.set(origin, members)
  }

  for (const edge of crossDomainEdges(bundle)) {
    remember(edge.origin, { name: edge.to, ref: edge.toRef, connected: true })
  }
  for (const descriptor of Object.values(ir.importsByKey)) {
    const { origin, name } = descriptor.ref
    if (origin === ir.domain) continue
    // An imported EDGE is a relationship, not a member to list: it shows as the line
    // between the two Classes it joins.
    if (ir.importedClassesByKey[descriptor.key]?.type === 'edge') continue
    remember(origin, { name, ref: descriptor.ref })
  }

  return [...byOrigin]
    .map(([origin, members]) => ({
      origin,
      kind: origin === 'kernel.astrale.ai' ? ('kernel' as const) : ('external' as const),
      // What the canvas connects first: the same reading the external frames use.
      members: [...members.values()].sort((left, right) =>
        !left.connected === !right.connected
          ? left.name.localeCompare(right.name)
          : left.connected
            ? -1
            : 1,
      ),
    }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.origin.localeCompare(right.origin)
        : left.kind === 'kernel'
          ? 1
          : -1,
    )
}
