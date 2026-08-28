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

export interface FlowNodeIdentity {
  domainId?: string
  localId: string
}

/** Non-greedy owner so the FIRST field segment splits the ref, not a later namesake. */
const MEMBER_FIELD = /^((?:class|edge)\..+?)\.(property|method|endpoint)\.(.+)$/

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Stable identity shared by comments and Ask. Keep the historical format intact. */
export function anchorKey(domainId: string, ref: string): string {
  return `${domainId}::${ref}`
}

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

/** Qualify a local React Flow id for a multi-domain canvas. */
export function encodeFlowNodeId(domainId: string, localId: string): string {
  return `workspace:${encodeURIComponent(domainId)}:${localId}`
}

/** Decode a node id emitted by either the single-domain or workspace canvas. */
export function decodeFlowNodeId(nodeId: string): FlowNodeIdentity {
  if (!nodeId.startsWith('workspace:')) return { localId: nodeId }
  const separator = nodeId.indexOf(':', 'workspace:'.length)
  if (separator < 0) return { localId: nodeId }
  return {
    domainId: safelyDecode(nodeId.slice('workspace:'.length, separator)),
    localId: nodeId.slice(separator + 1),
  }
}

/** Encode a cross-domain relationship while retaining its declaring domain. */
export function encodeFlowEdgeId(
  ownerDomainId: string,
  name: string,
  source: string,
  target: string,
): string {
  return `workspace-edge:${encodeURIComponent(ownerDomainId)}:${name}:${source}:${target}`
}

/** Convert a class/module React Flow id to the target ref used by comments and Ask. */
export function flowNodeAnchorRef(nodeId: string): string | null {
  const { localId } = decodeFlowNodeId(nodeId)
  if (localId.startsWith('class.')) return localId
  if (localId.startsWith('grp-')) return `module.${localId.slice('grp-'.length)}`
  return null
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
    : decodeFlowNodeId(edgeId).localId
  const name = localId
    .replace(/^edge-/, '')
    .split('__')[0]
    ?.trim()
  return name ? `edge.${name}` : null
}

/** Domain that owns a workspace edge; absent for an unqualified single-domain id. */
export function flowEdgeOwnerDomainId(edgeId: string): string | undefined {
  if (edgeId.startsWith('workspace-edge:')) {
    const separator = edgeId.indexOf(':', 'workspace-edge:'.length)
    const encoded = edgeId.slice('workspace-edge:'.length, separator < 0 ? undefined : separator)
    return encoded ? safelyDecode(encoded) : undefined
  }
  return decodeFlowNodeId(edgeId).domainId
}

/** Domain stamped on a target or on the canvas frame that contains it. */
export function targetElementDomainId(element: Element): string | undefined {
  if (element instanceof HTMLElement && element.dataset.domainId) return element.dataset.domainId
  const ancestor = element.closest<HTMLElement>('[data-domain-id]')
  if (ancestor?.dataset.domainId) return ancestor.dataset.domainId
  return element.querySelector<HTMLElement>('[data-domain-id]')?.dataset.domainId
}

function belongsToDomain(element: Element, domainId: string, encodedDomainId?: string): boolean {
  const owner = encodedDomainId ?? targetElementDomainId(element)
  return owner === undefined || owner === domainId
}

/**
 * Find the rendered element for a canonical target without interpolating user-controlled
 * refs into selectors. Workspace ids are decoded before comparison, so homonymous targets
 * in different domains remain distinct.
 */
export function locateTargetElement(
  root: ParentNode,
  domainId: string,
  ref: string,
): HTMLElement | null {
  if (ref.startsWith('class.') || ref.startsWith('module.')) {
    for (const element of root.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')) {
      const id = element.dataset.id ?? ''
      const identity = decodeFlowNodeId(id)
      if (flowNodeAnchorRef(id) === ref && belongsToDomain(element, domainId, identity.domainId))
        return element
    }
  }

  if (ref.startsWith('edge.')) {
    for (const element of root.querySelectorAll<HTMLElement>('.react-flow__edge[data-id]')) {
      const id = element.dataset.id ?? ''
      if (
        flowEdgeAnchorRef(id) === ref &&
        belongsToDomain(element, domainId, flowEdgeOwnerDomainId(id))
      )
        return element
    }
  }

  for (const element of root.querySelectorAll<HTMLElement>('[data-anchor-ref]')) {
    if (element.dataset.anchorRef === ref && belongsToDomain(element, domainId)) return element
  }
  return null
}

/** The data-* trio that makes an element a comment/ask target (read by comment mode). */
export function anchorData(ref: string, excerpt?: string) {
  return {
    'data-anchor-ref': ref,
    'data-anchor-excerpt': excerpt,
    'data-commentable': '',
  } as const
}
