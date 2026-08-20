import type { StudioSchemaBundle, VisibilityState } from '@shared/types'

import { type InterfaceBadge, domainInterfacesOf, interfaceBadge, memberRefKey } from './modules'

/**
 * visibility.ts — the SINGLE policy for what the schema canvas renders.
 *
 * Layered on top of the canvas's sensible defaults (everything canvas-renderable
 * is shown), this adds a per-element manual hide-set + one category toggle + the
 * interface materialize-set:
 *
 *   • hide-set        — a ref is hidden iff it's in `hidden` (membership ⇒ hidden;
 *                       no tri-state, because nothing is hidden by default — kernel
 *                       included, so the kernel-on-edge default stays visible).
 *                       Covers classes / edges / domains; interfaces do NOT use it.
 *   • inherited edges — the dashed, interface-INDUCED fan-out edges (one real edge
 *                       class resolved through a NON-materialized interface to every
 *                       implementer) are a category you can bulk-toggle.
 *   • materialize-set — local interfaces shown as canvas NODES instead of badges.
 *                       This is the interface's sole per-element control: a materialized
 *                       interface's fan-out collapses to a single edge to its node (so
 *                       per-interface muting is met by materialize + the global toggle +
 *                       per-edge-class hide — interfaces never join the generic hide-set).
 *
 * Hide-set refs use the same `<kind>.<name>` convention as the module tree (modules.ts):
 *   class.X | edge.X | domain.<origin>. The materialize-set is keyed by BARE interface name.
 */

export type Hidden = Record<string, true>
export type Materialized = Record<string, true>

/** Nothing hidden / nothing materialized by default; inherited (interface-induced) edges show. */
export const VISIBILITY_DEFAULT: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
  materializedInterfaces: {},
}

// class/edge refs share the tree's `<kind>.<name>` scheme — delegate to the one owner
// (modules.ts) so the keys the tree WRITES (m.ref) and the ones we READ never diverge.
export const classRef = (name: string) => memberRefKey('class', name)
export const edgeRef = (name: string) => memberRefKey('edge', name)
// domains aren't tree members, so this ref lives only here.
export const domainRef = (origin: string) => `domain.${origin}`

export function isHidden(ref: string, hidden: Hidden): boolean {
  return hidden[ref] === true
}

/** Whether a local interface is materialized as a canvas node (else it's a badge). */
export function isMaterialized(name: string, materialized: Materialized): boolean {
  return materialized[name] === true
}

/** Value-equality for a visibility slice (skips redundant disk writes of an unchanged slice). */
export function visibilityEqual(a: VisibilityState, b: VisibilityState): boolean {
  if (a.showInheritedEdges !== b.showInheritedEdges) return false
  const ak = Object.keys(a.hidden)
  if (ak.length !== Object.keys(b.hidden).length || !ak.every((k) => b.hidden[k])) return false
  const am = Object.keys(a.materializedInterfaces)
  return (
    am.length === Object.keys(b.materializedInterfaces).length &&
    am.every((k) => b.materializedInterfaces[k])
  )
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
 *   • it is interface-induced (poly) AND inherited edges are globally off.
 * `viaInterfaces` lists the interface(s) that induced this edge — one per endpoint
 * that fanned out through a NON-materialized interface (a materialized interface never
 * fans out; it reroutes to a single edge to its node). Empty ⇒ a direct, non-poly edge.
 * An interface-node endpoint passes an empty class name (`''`), never in the hide-set,
 * so the class-hide checks below are a no-op for it.
 */
export function edgeVisible(
  e: { edgeName: string; aClass: string; bClass: string; viaInterfaces: string[] },
  hidden: Hidden,
  showInheritedEdges: boolean,
): boolean {
  if (isHidden(edgeRef(e.edgeName), hidden)) return false
  if (isHidden(classRef(e.aClass), hidden) || isHidden(classRef(e.bClass), hidden)) return false
  if (e.viaInterfaces.length > 0 && !showInheritedEdges) return false
  return true
}

/** Interface badges for a class — its domain/external interfaces, minus any RENDERED as a node
 *  (a rendered interface is represented by its node + an `implements` edge, not a badge). The
 *  caller passes the set of interfaces actually drawn as nodes (materialized AND module expanded)
 *  so a materialized-but-not-drawn interface — e.g. its module is collapsed — keeps its badge,
 *  making badge ⇄ node mutually exclusive in every state (never both, never neither). */
export function visibleInterfaceBadges(
  bundle: StudioSchemaBundle,
  className: string,
  renderedInterfaces: ReadonlySet<string>,
): InterfaceBadge[] {
  const localOrigin = bundle.ir?.domain
  return domainInterfacesOf(bundle, className)
    .filter((ref) => {
      if (typeof ref === 'string') return !renderedInterfaces.has(ref)
      return ref.origin !== localOrigin || !renderedInterfaces.has(ref.name)
    })
    .map((ref) => interfaceBadge(ref, localOrigin))
}
