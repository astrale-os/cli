import type { IrEndpoint, StudioSchemaBundle } from '@shared/types'

/**
 * external.ts — the CROSS-DOMAIN data layer.
 *
 * We ONLY treat a true cross-domain EDGE CLASS as a cross-domain relationship:
 * an `edgeClass` whose endpoint references a class living in another domain
 * (it appears in `ir.imports` with `definition: 'class'`). Interface
 * implementations (`implements: [SomeExternalInterface]`) are NOT edges — those
 * are shown as little badges on the class, not links.
 */

export interface ExternalMember {
  name: string
  definition: 'interface' | 'class'
}
export interface ExternalDomain {
  origin: string
  kind: 'kernel' | 'external'
  /** the external classes this domain's edges connect to */
  members: ExternalMember[]
}

export interface CrossDomainEdge {
  edge: string
  from: string
  origin: string
  to: string
  /** declared cardinality of the local (`from`) and external (`to`) endpoints — so the
   *  canvas can draw the same ERD markers as internal edges (see cardinality-markers). */
  fromCard?: IrEndpoint['cardinality']
  toCard?: IrEndpoint['cardinality']
}

/** Each cross-domain edge: an edgeClass linking a local class to an external class. */
export function crossDomainEdges(bundle: StudioSchemaBundle): CrossDomainEdge[] {
  const ir = bundle.ir
  if (!ir) return []
  const out: CrossDomainEdge[] = []
  for (const [name, c] of Object.entries(ir.classes)) {
    if (c.type !== 'edge' || !c.endpoints) continue
    const types = c.endpoints.flatMap((ep) => ep.types)
    const external = types.filter((t) => ir.imports[t]?.definition === 'class')
    if (!external.length) continue
    const internal = types.filter((t) => ir.classes[t] && !ir.imports[t])
    // cardinality lives on the endpoint a type belongs to (role-level, not per-type)
    const cardOf = (t: string) => c.endpoints?.find((ep) => ep.types.includes(t))?.cardinality
    for (const to of external) {
      const origin = ir.imports[to].origin
      const toCard = cardOf(to)
      for (const from of internal)
        out.push({ edge: name, from, origin, to, fromCard: cardOf(from), toCard })
    }
  }
  return out
}

/** External domains connected via cross-domain edges, each with the external classes referenced. */
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
