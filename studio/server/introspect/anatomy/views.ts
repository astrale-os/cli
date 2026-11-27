import type { SourceFile } from 'ts-morph'

import type { SchemaIR, ViewInfo } from '../../../shared/contracts/schema'

import { schemaProject } from './schema-definition'
import { viewEntries } from './views/entries'
import { readViewReach, type ReachContext } from './views/reach'
import { buildFrontendViews, buildSchemaViewSources, readFrontends } from './views/routes'

function mergeRoute(target: ViewInfo, incoming: ViewInfo): void {
  if (incoming.kind !== 'unknown') target.kind = incoming.kind
  if (incoming.mount !== undefined) target.mount = incoming.mount
  if (incoming.url !== undefined) target.url = incoming.url
  if (incoming.file) target.file = incoming.file
}

function canonicalViewInfo(slug: string, view: NonNullable<SchemaIR['views']>[string]): ViewInfo {
  return {
    slug,
    kind: 'unknown',
    ...(view.description ? { description: view.description } : {}),
  }
}

/**
 * Join canonical View definitions with route/source metadata. Passing a
 * canonical map (including an empty map) makes it authoritative: static routes
 * cannot invent Views or override identity or description.
 * Without admitted canonical Views, Studio does not invent authoring semantics.
 * With a reach context, every View also carries what its code reaches.
 */
export function buildViews(
  root: string,
  schemaDirName = 'schema',
  canonicalViews?: NonNullable<SchemaIR['views']>,
  schemaSources: readonly SourceFile[] = schemaProject(root, schemaDirName),
  reach?: Omit<ReachContext, 'root' | 'schemaDirName'>,
): ViewInfo[] {
  const merged = new Map<string, ViewInfo>()
  const admittedViews = canonicalViews ?? {}
  for (const [slug, view] of Object.entries(admittedViews)) {
    merged.set(slug, canonicalViewInfo(slug, view))
  }
  for (const [slug, file] of buildSchemaViewSources(root, schemaSources)) {
    const current = merged.get(slug)
    if (current) current.file = file
  }
  const frontends = readFrontends(root)
  for (const view of buildFrontendViews(root, Object.keys(admittedViews), frontends)) {
    const current = merged.get(view.slug)
    if (current) mergeRoute(current, view)
  }
  if (reach && merged.size > 0) {
    const entries = viewEntries(root, frontends, [...merged.keys()])
    const reaches = readViewReach({ ...reach, root, schemaDirName }, entries)
    for (const [slug, view] of merged) {
      const found = reaches.get(slug)
      if (found) view.reach = found
    }
  }
  return [...merged.values()]
}
