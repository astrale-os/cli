import type { StudioSchemaBundle, VisibilityState } from '@shared/types'

import { domainInterfacesOf, memberRefKey } from './modules'

/**
 * visibility.ts — the SINGLE policy for what the schema canvas renders.
 *
 * Layered on top of the canvas's sensible defaults (everything canvas-renderable
 * is shown), this adds a per-element manual hide-set + one category toggle:
 *
 *   • hide-set        — a ref is hidden iff it's in `hidden` (membership ⇒ hidden;
 *                       no tri-state, because nothing is hidden by default — kernel
 *                       included, so the kernel-on-edge default stays visible).
 *   • inherited edges — the dashed, interface-INDUCED fan-out edges (one real edge
 *                       class resolved through an interface to every implementer)
 *                       are a category you can bulk-toggle, and each can be muted
 *                       individually by hiding its inducing interface.
 *
 * Refs use the same `<kind>.<name>` convention as the module tree (modules.ts):
 *   class.X | edge.X | interface.X | domain.<origin>
 */

export type Hidden = Record<string, true>

/** Nothing is hidden by default; inherited (interface-induced) edges show. */
export const VISIBILITY_DEFAULT: VisibilityState = { hidden: {}, showInheritedEdges: true }

// class/edge/interface refs share the tree's `<kind>.<name>` scheme — delegate to the one
// owner (modules.ts) so the keys the tree WRITES (m.ref) and the ones we READ never diverge.
export const classRef = (name: string) => memberRefKey('class', name)
export const edgeRef = (name: string) => memberRefKey('edge', name)
export const interfaceRef = (name: string) => memberRefKey('interface', name)
// domains aren't tree members, so this ref lives only here.
export const domainRef = (origin: string) => `domain.${origin}`

export function isHidden(ref: string, hidden: Hidden): boolean {
  return hidden[ref] === true
}

/** Value-equality for a visibility slice (skips redundant disk writes of an unchanged slice). */
export function visibilityEqual(a: VisibilityState, b: VisibilityState): boolean {
  if (a.showInheritedEdges !== b.showInheritedEdges) return false
  const ak = Object.keys(a.hidden)
  return ak.length === Object.keys(b.hidden).length && ak.every((k) => b.hidden[k])
}

/** A class node renders unless explicitly hidden. (Module-collapse is orthogonal.) */
export function classNodeVisible(name: string, hidden: Hidden): boolean {
  return !isHidden(classRef(name), hidden)
}

/** An external domain (incl. kernel) renders unless its origin is hidden. */
export function domainVisible(origin: string, hidden: Hidden): boolean {
  return !isHidden(domainRef(origin), hidden)
}

/**
 * Whether a schema edge between two class names renders. An edge drops when:
 *   • its edge class is hidden, OR
 *   • either endpoint class is hidden (no dangling edges into hidden nodes), OR
 *   • it is interface-induced (poly) AND inherited edges are globally off
 *     OR ANY inducing interface is hidden.
 * `viaInterfaces` lists the interface(s) that induced this edge — one per endpoint
 * that fanned out through an interface (so a both-ends-polymorphic edge carries two,
 * and hiding EITHER inducing interface mutes it). Empty ⇒ a direct, non-poly edge.
 */
export function edgeVisible(
  e: { edgeName: string; aClass: string; bClass: string; viaInterfaces: string[] },
  hidden: Hidden,
  showInheritedEdges: boolean,
): boolean {
  if (isHidden(edgeRef(e.edgeName), hidden)) return false
  if (isHidden(classRef(e.aClass), hidden) || isHidden(classRef(e.bClass), hidden)) return false
  if (e.viaInterfaces.length > 0) {
    if (!showInheritedEdges) return false
    if (e.viaInterfaces.some((i) => isHidden(interfaceRef(i), hidden))) return false
  }
  return true
}

/** Interface badges for a class, minus any the user has hidden. */
export function visibleInterfaceBadges(
  bundle: StudioSchemaBundle,
  className: string,
  hidden: Hidden,
): string[] {
  return domainInterfacesOf(bundle, className).filter((i) => !isHidden(interfaceRef(i), hidden))
}

/** Filter a precomputed interface-name list (e.g. a GroupNode's) against the hide-set. */
export function filterHiddenInterfaces(interfaces: string[], hidden: Hidden): string[] {
  return interfaces.filter((i) => !isHidden(interfaceRef(i), hidden))
}
