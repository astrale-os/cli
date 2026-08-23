import type { IrClassRef, IrEndpoint, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { classRefKey, isIrClassRef } from '@shared/schema/identity'

export interface ExternalMember {
  name: string
  ref: IrClassRef
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

export function externalMemberNodeId(origin: string, name: string): string {
  return `extmember.${origin}.class.${name}`
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

export function externalDomains(bundle: StudioSchemaBundle): ExternalDomain[] {
  const byOrigin = new Map<string, Map<string, ExternalMember>>()
  for (const edge of crossDomainEdges(bundle)) {
    const members = byOrigin.get(edge.origin) ?? new Map<string, ExternalMember>()
    members.set(classRefKey(edge.toRef), { name: edge.to, ref: edge.toRef })
    byOrigin.set(edge.origin, members)
  }
  return [...byOrigin]
    .map(([origin, members]) => ({
      origin,
      kind: origin === 'kernel.astrale.ai' ? ('kernel' as const) : ('external' as const),
      members: [...members.values()].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.origin.localeCompare(right.origin)
        : left.kind === 'kernel'
          ? 1
          : -1,
    )
}
