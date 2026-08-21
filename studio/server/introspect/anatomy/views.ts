import type { SchemaIR, ViewInfo } from '../../../shared/types'

import { buildLegacyViews } from './views/legacy'
import { buildFrontendViews, buildSchemaViewSources } from './views/routes'

function mergeRoute(target: ViewInfo, incoming: ViewInfo): void {
  if (incoming.kind !== 'unknown') target.kind = incoming.kind
  if (incoming.mount !== undefined) target.mount = incoming.mount
  if (incoming.url !== undefined) target.url = incoming.url
  if (incoming.file) target.file = incoming.file
}

function canonicalViewInfo(slug: string, view: NonNullable<SchemaIR['views']>[string]): ViewInfo {
  const targets =
    view.target.kind === 'definition' ? view.target.definitions.map((ref) => ref.name) : []
  return {
    slug,
    kind: 'unknown',
    auth: view.auth,
    ...(view.description ? { description: view.description } : {}),
    ...(targets.length === 1
      ? { viewFor: targets[0] }
      : targets.length > 1
        ? { viewFor: targets }
        : {}),
  }
}

/**
 * Join canonical View definitions with route/source metadata. Passing a
 * canonical map (including an empty map) makes it authoritative: static routes
 * cannot invent Views or override identity, target, auth, or description.
 * Without it, the legacy defineView registry remains the compatibility source.
 */
export function buildViews(
  root: string,
  _schemaDirName = 'schema',
  canonicalViews?: NonNullable<SchemaIR['views']>,
): ViewInfo[] {
  const merged = new Map<string, ViewInfo>()
  if (canonicalViews !== undefined) {
    for (const [slug, view] of Object.entries(canonicalViews)) {
      merged.set(slug, canonicalViewInfo(slug, view))
    }
    for (const [slug, file] of buildSchemaViewSources(root, _schemaDirName)) {
      const current = merged.get(slug)
      if (current) current.file = file
    }
  } else {
    for (const view of buildLegacyViews(root)) merged.set(view.slug, view)
  }
  for (const view of buildFrontendViews(root)) {
    const current = merged.get(view.slug)
    if (current) mergeRoute(current, view)
    else if (canonicalViews === undefined) merged.set(view.slug, view)
  }
  return [...merged.values()]
}
