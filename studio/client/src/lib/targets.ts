import type { AnchorKind } from '@shared/types'

/**
 * targets.ts — the ONE place that knows how a comment/ask TARGET is encoded.
 *
 * A target is the schema entity (or section) a comment attaches to. Targets form
 * a containment hierarchy, coarsest → finest:
 *   section.<id>                          a whole tab (the schema canvas, env…)
 *   view.<slug>                           a declared domain view (Views panel rows)
 *   module.<path>                         a file/folder grouping of members
 *   class|edge.<Name>                     a member
 *   class|edge.<Name>.property|method|endpoint.<x>             a member's field
 *
 * Resolution rule (see comment-mode.tsx): the NEAREST declared scope wins. Every
 * surface stamps the most specific ref it represents via `anchorData()`; the
 * resolver climbs the DOM with `closest('[data-anchor-ref]')`, so unmarked gaps
 * resolve to their enclosing scope instead of collapsing to the section.
 */

export type SchemaMemberKind = 'class' | 'edge'

/** The finest targets in the hierarchy: the fields a schema member owns. */
export type MemberFieldKind = 'property' | 'method' | 'endpoint'

/** Non-greedy owner so the FIRST field segment splits the ref, not a later namesake. */
const MEMBER_FIELD = /^((?:class|edge)\..+?)\.(property|method|endpoint)\.(.+)$/

/** The AnchorKind implied by a ref's namespace (used when stamping a free click). */
export function anchorKindForRef(ref: string): AnchorKind {
  if (/^(class|edge)\./.test(ref)) return 'schema'
  if (/^(module|section|view)\./.test(ref)) return 'section'
  if (ref.startsWith('file.')) return 'file'
  return 'free'
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

/** The anchor ref for a schema member (edges live under the `edge.` namespace). */
export function schemaMemberRef(kind: SchemaMemberKind, name: string): string {
  return `${kind}.${name}`
}

/**
 * Normalize a ReactFlow edge element's `data-id` to its edge-class ref. Canvas
 * edges are keyed either `edge-<Class>` or `edge-<Class>__<A>__<B>` (class + the
 * two endpoints), so stripping the `edge-` prefix alone can yield
 * `edge.<Class>__<A>__<B>` — a ref that matches no schema member. Keep only the
 * class segment so both forms resolve to `edge.<Class>`.
 */
export function flowEdgeAnchorRef(edgeId: string): string | null {
  const localId = edgeId.startsWith('workspace-edge:')
    ? `edge-${edgeId.split(':')[2] ?? ''}`
    : edgeId.startsWith('workspace:')
      ? edgeId.split(':').slice(2).join(':')
      : edgeId
  const name = localId
    .replace(/^edge-/, '')
    .split('__')[0]
    ?.trim()
  return name ? `edge.${name}` : null
}

/** The data-* trio that makes an element a comment/ask target (read by comment mode). */
export function anchorData(ref: string, excerpt?: string) {
  return {
    'data-anchor-ref': ref,
    'data-anchor-excerpt': excerpt,
    'data-commentable': '',
  } as const
}
