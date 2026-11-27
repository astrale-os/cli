import type { AnchorKind, AnchorRef } from '@shared/contracts/workspace'

import { concreteAnchorKind } from '@shared/comment-anchors'

/**
 * targets.ts — the ONE place that knows how a comment/ask TARGET is encoded.
 *
 * A target is the schema entity (or section) a comment attaches to. Targets form
 * a containment hierarchy, coarsest → finest:
 *   domain.<origin>                       a whole domain (its frame, its crumb in the bar)
 *   section.<id>                          a whole tab (the schema canvas, env…)
 *   view.<slug>                           a declared domain view (Views panel rows)
 *   function.<name>                       a standalone domain Function (no receiver)
 *   module.<path>                         a file/folder grouping of members
 *   class|edge.<Name>                     a member
 *   class|edge.<Name>.property|method|endpoint.<x>             a member's field
 *
 * `domain.` is keyed by ORIGIN, not by the workspace's local id: the origin is the
 * domain's own name, stable across workspaces and readable by the agent, and the
 * namespace is already spelled that way by an import request (`domain.import.<origin>`).
 *
 * Resolution rule (`targetAt`): the NEAREST declared scope wins. Every surface stamps
 * the most specific ref it represents via `anchorData()`; the resolver climbs the DOM
 * with `closest('[data-anchor-ref]')`, so unmarked gaps resolve to their enclosing
 * scope instead of collapsing to the section. A target is then found again where it
 * was made (`locateTarget`), never at a namesake on another surface.
 */

type SchemaMemberKind = 'class' | 'edge'

/** The finest targets in the hierarchy: the fields a schema member owns. */
type MemberFieldKind = 'property' | 'method' | 'endpoint'

/** Non-greedy owner so the FIRST field segment splits the ref, not a later namesake. */
const MEMBER_FIELD = /^((?:class|edge)\..+?)\.(property|method|endpoint)\.(.+)$/

/** Stable identity shared by comments and Ask. Keep the historical format intact. */
export function anchorKey(domainId: string, ref: string): string {
  return `${domainId}::${ref}`
}

/** The AnchorKind implied by a concrete domain-element ref. */
export function anchorKindForRef(ref: string): AnchorKind {
  const kind = concreteAnchorKind(ref)
  if (kind) return kind
  throw new Error(`unsupported comment anchor: ${ref}`)
}

/**
 * Split a member field ref (`class.Order.property.total`) into the member that owns it
 * and the field itself. Returns null for anything coarser — a member, a module, a section.
 */
export function parseMemberFieldRef(
  ref: string,
): { owner: string; kind: MemberFieldKind; name: string } | null {
  const match = MEMBER_FIELD.exec(ref)
  if (!match) return null
  return { owner: match[1]!, kind: match[2] as MemberFieldKind, name: match[3]! }
}

/**
 * The ref whose detail view CONTAINS `ref`. A field has no view of its own, so the
 * panel opens its owning Class and singles the field out there; everything else
 * already is its own detail.
 */
export function detailRefFor(ref: string): string {
  return parseMemberFieldRef(ref)?.owner ?? ref
}

/** A module only GROUPS members, so the detail panel never opens one. */
export function isModuleRef(ref: string): boolean {
  return ref.startsWith('module.')
}

/** The anchor ref for a whole domain. Keyed by origin — see the hierarchy above. */
export function domainAnchorRef(origin: string): string {
  return `domain.${origin}`
}

/** The anchor ref for a schema member (edges live under the `edge.` namespace). */
export function schemaMemberRef(kind: SchemaMemberKind, name: string): string {
  return `${kind}.${name}`
}

/**
 * A target where it was made. One Domain element is drawn on several surfaces at once — a Class
 * is a card on the canvas, a row in the Index, the Inspector's page — and an Ask or a comment
 * belongs to the one it was made on: it stays on that element through pan, zoom and scroll, and
 * never moves to a namesake elsewhere, nor to the same element of another Domain.
 */
export interface Target {
  /** The Domain whose element it is: where its thread is filed, whose Schema Ask reads. */
  domainId: string
  anchor: AnchorRef
  excerpt: string
  /** The surface it was made on (`targetSurface`); undefined on a surface that names none. */
  surface: string | undefined
  /** The element it was made on. */
  element: Element
}

/** The surfaces that draw targets: each names itself with `targetSurface` on its root. */
export type TargetSurface = 'canvas' | 'index' | 'inspector' | 'bar'

/** The stamp that names the surface every target inside an element is drawn on. */
export function targetSurface(surface: TargetSurface) {
  return { 'data-target-surface': surface } as const
}

/**
 * The Domain a target element belongs to: the owner stamped on it (`anchorData`), else the
 * Domain drawn around it (`data-domain-id`). Making a target and finding it again read this one
 * rule. An element neither names is no target.
 */
export function targetOwnerOf(element: Element): string | undefined {
  return (
    element.getAttribute('data-anchor-domain-id') ||
    element.closest('[data-domain-id]')?.getAttribute('data-domain-id') ||
    undefined
  )
}

/** The surface a target element is drawn on, as the nearest `targetSurface` stamp names it. */
function surfaceOf(element: Element): string | undefined {
  return element.closest('[data-target-surface]')?.getAttribute('data-target-surface') || undefined
}

/**
 * The target a click on `element` makes: the nearest stamp around it, so the most specific
 * scope wins and an unmarked gap resolves to the scope that encloses it. Null where no stamp,
 * or no owner, says what was clicked.
 */
export function targetAt(element: Element | null): Target | null {
  const tagged = element?.closest('[data-anchor-ref]')
  const ref = tagged?.getAttribute('data-anchor-ref')
  if (!tagged || !ref) return null
  const domainId = targetOwnerOf(tagged)
  if (domainId === undefined) return null
  const excerpt = tagged.getAttribute('data-anchor-excerpt') || tagged.textContent || ref
  return {
    domainId,
    anchor: { ref, kind: anchorKindForRef(ref) },
    excerpt: excerpt.trim().slice(0, 80),
    surface: surfaceOf(tagged),
    element: tagged,
  }
}

function standsFor(element: Element, target: Target): boolean {
  return (
    element.getAttribute('data-anchor-ref') === target.anchor.ref &&
    targetOwnerOf(element) === target.domainId &&
    surfaceOf(element) === target.surface
  )
}

/**
 * Where a target is drawn now: the element it was made on while that element is on the page,
 * else the element that took its place — the same ref of the same Domain on the same surface —
 * once a redraw replaced it. Refs are compared, never interpolated into a selector.
 */
export function locateTarget(root: ParentNode, target: Target): Element | null {
  if (target.element.isConnected && standsFor(target.element, target)) return target.element
  for (const element of root.querySelectorAll('[data-anchor-ref]')) {
    if (standsFor(element, target)) return element
  }
  return null
}

/**
 * The data-* stamps that make an element a comment/ask target (read by comment mode).
 *
 * `domainId` says which domain's thread store the comment belongs in, for surfaces whose
 * OWNER is not the domain they are drawn inside — the bar's Domain crumb and the Index rows
 * sit outside any `data-domain-id` (that stamp means "this is on screen" to the ask layer).
 * Left out, the resolver must find an owner in the rendered hierarchy.
 */
export function anchorData(ref: string, excerpt?: string, domainId?: string) {
  return {
    'data-anchor-ref': ref,
    'data-anchor-excerpt': excerpt,
    'data-anchor-domain-id': domainId,
    'data-commentable': '',
  } as const
}
