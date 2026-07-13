import type { IrEndpoint, SchemaIR, StudioSchemaBundle } from '@shared/types'

/**
 * external.ts — the CROSS-DOMAIN data layer.
 *
 * We ONLY treat a true cross-domain EDGE CLASS as a cross-domain relationship:
 * an `edgeClass` whose endpoint references a class or interface living in another
 * domain (it appears in `ir.imports`). Interface implementations
 * (`implements: [SomeExternalInterface]`) are NOT edges — those remain metadata
 * on the implementing class.
 */

export interface ExternalMember {
  name: string
  definition: 'interface' | 'class'
}
export interface ExternalDomain {
  origin: string
  kind: 'kernel' | 'external'
  /** the external classes/interfaces this domain's edges connect to */
  members: ExternalMember[]
}

export interface CrossDomainEdge {
  edge: string
  /** locally declared endpoint type; may be a concrete class or an interface */
  from: string
  origin: string
  to: string
  /** declared cardinality of the local (`from`) and external (`to`) endpoints — so the
   *  canvas can draw the same ERD markers as internal edges (see cardinality-markers). */
  fromCard?: IrEndpoint['cardinality']
  toCard?: IrEndpoint['cardinality']
}

export interface LocalEndpointTarget {
  cls: string | null
  ifaceNode: string | null
  /** inducing interface when a non-materialized endpoint fans out to an implementing class */
  viaInterface: string | null
}

/**
 * Resolve locally-owned endpoint types into canvas targets. A rendered interface is one target;
 * otherwise it fans out to its concrete implementers. Imported types are deliberately ignored.
 */
export function localEndpointTargets(
  ir: SchemaIR,
  endpoint: { types?: string[] } | undefined,
  interfaceRendered: (name: string) => boolean,
): LocalEndpointTarget[] {
  const out: LocalEndpointTarget[] = []
  const seen = new Set<string>()
  for (const type of endpoint?.types ?? []) {
    if (ir.classes[type]?.type === 'node') {
      if (!seen.has(type)) {
        seen.add(type)
        out.push({ cls: type, ifaceNode: null, viaInterface: null })
      }
      continue
    }
    if (!ir.interfaces[type]) continue
    if (interfaceRendered(type)) {
      const ifaceNode = `iface.${type}`
      if (!seen.has(ifaceNode)) {
        seen.add(ifaceNode)
        out.push({ cls: null, ifaceNode, viaInterface: null })
      }
      continue
    }
    for (const [className, cls] of Object.entries(ir.classes)) {
      if (cls.type === 'node' && (cls.implements ?? []).includes(type) && !seen.has(className)) {
        seen.add(className)
        out.push({ cls: className, ifaceNode: null, viaInterface: type })
      }
    }
  }
  return out
}

/** Each cross-domain edge: an edgeClass linking a local endpoint type to an imported one. */
export function crossDomainEdges(bundle: StudioSchemaBundle): CrossDomainEdge[] {
  const ir = bundle.ir
  if (!ir) return []
  const out: CrossDomainEdge[] = []
  for (const [name, c] of Object.entries(ir.classes)) {
    if (c.type !== 'edge' || !c.endpoints) continue
    const a = c.endpoints[0]
    const b = c.endpoints[1]
    if (!a || !b) continue
    for (const [localEndpoint, externalEndpoint] of [
      [a, b],
      [b, a],
    ] as const) {
      const local = localEndpoint.types.filter(
        (type) => ir.classes[type]?.type === 'node' || ir.interfaces[type] !== undefined,
      )
      const external = externalEndpoint.types.filter((type) => ir.imports[type] !== undefined)
      for (const to of external) {
        const origin = ir.imports[to].origin
        for (const from of local) {
          out.push({
            edge: name,
            from,
            origin,
            to,
            fromCard: localEndpoint.cardinality,
            toCard: externalEndpoint.cardinality,
          })
        }
      }
    }
  }
  return out
}

/** External domains connected via cross-domain edges, with each referenced endpoint type. */
export function externalDomains(bundle: StudioSchemaBundle): ExternalDomain[] {
  const ir = bundle.ir
  if (!ir) return []
  const byOrigin = new Map<string, Map<string, ExternalMember>>()
  for (const e of crossDomainEdges(bundle)) {
    if (!byOrigin.has(e.origin)) byOrigin.set(e.origin, new Map())
    byOrigin
      .get(e.origin)!
      .set(e.to, { name: e.to, definition: ir.imports[e.to]?.definition ?? 'class' })
  }
  const domains: ExternalDomain[] = []
  for (const [origin, members] of byOrigin) {
    domains.push({
      origin,
      kind: origin === 'kernel.astrale.ai' ? 'kernel' : 'external',
      members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
    })
  }
  return domains.sort((a, b) =>
    a.kind === b.kind ? a.origin.localeCompare(b.origin) : a.kind === 'kernel' ? 1 : -1,
  )
}
