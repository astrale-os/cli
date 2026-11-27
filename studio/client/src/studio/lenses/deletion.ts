/**
 * What deleting a Node does to the links it stands in, end by end, as the Kernel's lifetimes
 * (`lifetimesOf`) say: a `detach` link goes with the Node; a `restrict` link refuses the deletion
 * unless the same change deletes the link (MUT-DETACHED-EDGES). Read over the relationships of the
 * Domain on screen: those of the Domains that depend on it are not in its bundle.
 */

import type { DefinitionEffect, DefinitionLink, StudioSchemaBundle } from '@shared/contracts/schema'

import { classRefKey, type IrClassRef } from '@shared/schema/identity'

import { effectClass } from '../../schema-studio/definitions'
import { KERNEL_ORIGIN, resolveClass } from '../../schema-studio/inheritance'
import { type Lifetime, lifetimesOf } from './lifetimes'
import { endpointRefs, lineage } from './structure'

/** One end of a relationship of the Domain that holds a Class's Nodes, with its lifetime. */
export interface HeldEnd {
  readonly relationship: IrClassRef
  /** the end, in endpoint order */
  readonly index: 0 | 1
  readonly role: string
  readonly lifetime: Lifetime
  readonly declared: boolean
  /** every Node there has at least one such link: deleting one always meets it */
  readonly always: boolean
  /** the Classes the other end accepts */
  readonly others: readonly IrClassRef[]
  /** the Class's ancestor the end accepts, when it does not name the Class itself */
  readonly through?: IrClassRef
  /** the end accepts any Node */
  readonly any?: true
}

const GRAPH_ROOT = classRefKey({ origin: KERNEL_ORIGIN, kind: 'class', name: 'Node' })

/**
 * The ends of the Domain's relationships a Node of `ref` can stand at, in declaration and
 * endpoint order, each with its lifetime: none when the lifetimes are not read.
 */
export function endsHolding(
  bundle: StudioSchemaBundle,
  ref: IrClassRef,
): readonly HeldEnd[] | undefined {
  const lifetimes = lifetimesOf(bundle)
  const ir = bundle.ir
  if (lifetimes === undefined || ir === null) return undefined
  const self = classRefKey(ref)
  const lineal = lineage(bundle, ref)
  const held: HeldEnd[] = []
  for (const [name, member] of Object.entries(ir.classes)) {
    if (member.type !== 'edge' || member.endpoints === undefined || member.endpoints.length < 2)
      continue
    const relationship: IrClassRef = { origin: ir.domain, kind: 'class', name }
    const found = lifetimes.get(classRefKey(relationship))
    if (found === undefined) continue
    for (const index of [0, 1] as const) {
      const endpoint = member.endpoints[index]!
      const accepted = endpointRefs(endpoint, ir.domain)
      const keys = accepted.map(classRefKey)
      const any = !keys.includes(self) && keys.includes(GRAPH_ROOT)
      const through = keys.includes(self)
        ? undefined
        : accepted.find((each) => lineal.has(classRefKey(each)))
      if (!keys.includes(self) && through === undefined && !any) continue
      held.push({
        relationship,
        index,
        role: endpoint.name,
        lifetime: found.ends[index],
        declared: found.declared[index],
        always: (endpoint.cardinality?.min ?? 0) >= 1,
        others: endpointRefs(member.endpoints[1 - index], ir.domain),
        ...(through === undefined || any ? {} : { through }),
        ...(any ? { any: true as const } : {}),
      })
    }
  }
  return held
}

/**
 * What becomes of a link at a Node a mutation deletes: `detached`, removed with it; `unlinked`,
 * the mutation removes it itself; `refused`, the end restricts and nothing in the mutation
 * removes it, so the deletion is refused while the Node has one; `untold`, the end restricts and
 * the reading cannot follow all the mutation does.
 */
export type DeletionOutcome = 'detached' | 'unlinked' | 'refused' | 'untold'

export interface Consequence extends HeldEnd {
  readonly outcome: DeletionOutcome
}

/**
 * What a mutation's deletion of a Node does to the links it stands in, end by end: none for any
 * other effect, or when the lifetimes are not read.
 */
export function consequencesOf(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  effect: DefinitionEffect,
): readonly Consequence[] | undefined {
  if (effect.kind !== 'delete' || bundle.ir === null) return undefined
  const domain = bundle.ir.domain
  const ref = effectClass(domain, effect.class)
  if (resolveClass(bundle, ref)?.type !== 'node') return undefined
  const ends = endsHolding(bundle, ref)
  if (ends === undefined) return undefined
  // The Edge Classes the mutation deletes Edges of itself.
  const unlinks = (definition.effects ?? []).flatMap((other) => {
    if (other.kind !== 'delete') return []
    const edge = effectClass(domain, other.class)
    return resolveClass(bundle, edge)?.type === 'edge' ? [classRefKey(edge)] : []
  })
  const untold = (definition.gaps ?? []).length > 0
  return ends.map((end): Consequence => {
    // it deletes Edges of the relationship, or of a Class the relationship is
    const relationship = lineage(bundle, end.relationship)
    const removed = unlinks.some((edge) => relationship.has(edge))
    const outcome: DeletionOutcome = removed
      ? 'unlinked'
      : end.lifetime === 'detach'
        ? 'detached'
        : untold
          ? 'untold'
          : 'refused'
    return { ...end, outcome }
  })
}
