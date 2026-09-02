import type { AnchorKind, AnchorRef } from './contracts/workspace'

const PREFIXES: readonly { prefix: string; kind: AnchorKind }[] = [
  { prefix: 'class.', kind: 'schema' },
  { prefix: 'edge.', kind: 'schema' },
  { prefix: 'function.', kind: 'schema' },
  { prefix: 'domain.', kind: 'section' },
  { prefix: 'module.', kind: 'section' },
  { prefix: 'view.', kind: 'section' },
  { prefix: 'section.', kind: 'section' },
  { prefix: 'core.node.', kind: 'section' },
  { prefix: 'integration.request.', kind: 'section' },
  { prefix: 'file.', kind: 'file' },
]

/** Infer the kind of a named domain element; broad canvas/page scopes are not anchors. */
export function concreteAnchorKind(value: string): AnchorKind | undefined {
  if (value !== value.trim() || value === 'section.schema') return undefined
  const match = PREFIXES.find(({ prefix }) => value.startsWith(prefix))
  return match && value.slice(match.prefix.length).trim() ? match.kind : undefined
}

/** Whether an anchor names a supported concrete element and carries the matching kind. */
export function isConcreteAnchorRef(anchor: Pick<AnchorRef, 'ref' | 'kind'>): boolean {
  return concreteAnchorKind(anchor.ref) === anchor.kind
}
