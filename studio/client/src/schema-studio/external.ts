import type { IrDefinitionRef, IrEndpoint, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { definitionRefKey, isIrDefinitionRef } from '@shared/schema/identity'

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
  /** Exact imported Definition. Absent only for legacy name-only endpoints. */
  ref?: IrDefinitionRef
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
  /** Exact endpoint coordinates. Absent only for legacy name-only endpoints. */
  fromRef?: IrDefinitionRef
  toRef?: IrDefinitionRef
  /** declared cardinality of the local (`from`) and external (`to`) endpoints — so the
   *  canvas can draw the same ERD markers as internal edges (see cardinality-markers). */
  fromCard?: IrEndpoint['cardinality']
  toCard?: IrEndpoint['cardinality']
}

/** Canvas identity for an imported endpoint definition. Kind is part of the key by contract. */
export function externalMemberNodeId(
  origin: string,
  name: string,
  definition: ExternalMember['definition'],
): string {
  return `extmember.${origin}.${definition}.${name}`
}

interface EndpointDefinition {
  name: string
  ref?: IrDefinitionRef
}

function sameDefinition(a: IrDefinitionRef, b: IrDefinitionRef): boolean {
  return a.origin === b.origin && a.kind === b.kind && a.name === b.name
}

/** Canonical endpoint refs are authoritative; `types` is consulted only for legacy IR. */
function endpointDefinitions(
  endpoint: Pick<IrEndpoint, 'types' | 'refs'> | undefined,
): EndpointDefinition[] {
  if (!endpoint) return []
  if (endpoint.refs !== undefined)
    return endpoint.refs.filter(isIrDefinitionRef).map((ref) => ({ name: ref.name, ref }))
  return (endpoint.types ?? []).map((name) => ({ name }))
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
  endpoint: Pick<IrEndpoint, 'types' | 'refs'> | undefined,
  interfaceRendered: (name: string) => boolean,
): LocalEndpointTarget[] {
  const out: LocalEndpointTarget[] = []
  const seen = new Set<string>()
  for (const target of endpointDefinitions(endpoint)) {
    const { name, ref } = target
    if (ref && ref.origin !== ir.domain) continue

    const exactClass = ref?.kind === 'class'
    const exactInterface = ref?.kind === 'interface'
    const legacyClass = !ref && ir.classes[name]?.type === 'node'
    const legacyInterface = !ref && ir.interfaces[name] !== undefined

    if ((exactClass || legacyClass) && ir.classes[name]?.type === 'node') {
      if (!seen.has(name)) {
        seen.add(name)
        out.push({ cls: name, ifaceNode: null, viaInterface: null })
      }
      continue
    }
    if (!(exactInterface || legacyInterface) || !ir.interfaces[name]) continue
    if (interfaceRendered(name)) {
      const ifaceNode = `iface.${name}`
      if (!seen.has(ifaceNode)) {
        seen.add(ifaceNode)
        out.push({ cls: null, ifaceNode, viaInterface: null })
      }
      continue
    }
    for (const [className, cls] of Object.entries(ir.classes)) {
      const implementsTarget = ref
        ? cls.implementsRefs
            ?.filter(isIrDefinitionRef)
            .some((candidate) => sameDefinition(candidate, ref)) === true
        : (cls.implements ?? []).includes(name)
      if (cls.type === 'node' && implementsTarget && !seen.has(className)) {
        seen.add(className)
        out.push({ cls: className, ifaceNode: null, viaInterface: name })
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
      const local = endpointDefinitions(localEndpoint).filter(({ name: memberName, ref }) => {
        if (ref)
          return (
            ref.origin === ir.domain &&
            (ref.kind === 'interface' || ir.classes[memberName]?.type === 'node') &&
            (ref.kind !== 'interface' || ir.interfaces[memberName] !== undefined)
          )
        return ir.classes[memberName]?.type === 'node' || ir.interfaces[memberName] !== undefined
      })
      const external = endpointDefinitions(externalEndpoint).flatMap((target) => {
        if (target.ref) {
          if (target.ref.origin === ir.domain) return []
          const descriptor = ir.importsByKey?.[definitionRefKey(target.ref)]
          // The exact endpoint remains sufficient when a partial projection lacks the index; an
          // exact ref must never fall through to the collision-prone short-name map.
          return [{ ...target, ref: descriptor?.ref ?? target.ref }]
        }
        return ir.imports[target.name] ? [target] : []
      })
      for (const target of external) {
        const origin = target.ref?.origin ?? ir.imports[target.name]?.origin
        if (!origin) continue
        for (const source of local) {
          out.push({
            edge: name,
            from: source.name,
            origin,
            to: target.name,
            ...(source.ref ? { fromRef: source.ref } : {}),
            ...(target.ref ? { toRef: target.ref } : {}),
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
    const definition = e.toRef?.kind ?? ir.imports[e.to]?.definition ?? 'class'
    const identity = e.toRef ? definitionRefKey(e.toRef) : `${definition}.${e.to}`
    byOrigin.get(e.origin)!.set(identity, {
      name: e.to,
      definition,
      ...(e.toRef ? { ref: e.toRef } : {}),
    })
  }
  const domains: ExternalDomain[] = []
  for (const [origin, members] of byOrigin) {
    domains.push({
      origin,
      kind: origin === 'kernel.astrale.ai' ? 'kernel' : 'external',
      members: [...members.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.definition.localeCompare(b.definition),
      ),
    })
  }
  return domains.sort((a, b) =>
    a.kind === b.kind ? a.origin.localeCompare(b.origin) : a.kind === 'kernel' ? 1 : -1,
  )
}
