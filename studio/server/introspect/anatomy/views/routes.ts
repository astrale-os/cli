import { join, relative } from 'node:path'
import { Node, type SourceFile, SyntaxKind } from 'ts-morph'

import type { ViewInfo } from '../../../../shared/types'

import { resolveApplicationEntry } from '../../../domain'
import { defineSchemaCalls, schemaProject } from '../schema-definition'
import {
  addSource,
  callName,
  listSourceFiles,
  literalString,
  makeProject,
  objectProperty,
  objectValue,
  propertySlug,
  propertyValue,
} from '../source'

/** Locate authored declarations for canonical View keys without projecting any semantics. */
export function buildSchemaViewSources(root: string, schemaDirName: string): Map<string, string> {
  const sources = new Map<string, string>()
  for (const source of schemaProject(root, schemaDirName)) {
    for (const call of defineSchemaCalls(source)) {
      const input = objectValue(call.getArguments()[1], source)
      const declared = input
        ? objectValue(objectProperty(input, 'views', source) ?? undefined, source)
        : null
      if (!declared || !Node.isObjectLiteralExpression(declared)) continue
      for (const property of declared.getProperties()) {
        const slug = propertySlug(property)
        const declaration = propertyValue(property, source)
        if (
          slug &&
          declaration &&
          Node.isCallExpression(declaration) &&
          callName(declaration) === 'view'
        ) {
          sources.set(slug, relative(root, source.getFilePath()).replaceAll('\\', '/'))
        }
      }
    }
  }
  return sources
}

function defaultRoute(name: string): string {
  return `/${name
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[_\s]+/gu, '-')
    .toLowerCase()}`
}

function frontendSource(input: Node, source: SourceFile): { externalOrigin?: string } {
  const value = objectProperty(input, 'source', source)
  if (!value || !Node.isCallExpression(value)) return {}
  if (callName(value) !== 'external') return {}
  const origin = literalString(value.getArguments()[0], source)
  return origin === undefined ? {} : { externalOrigin: origin }
}

export function buildFrontendViews(
  root: string,
  canonicalViewNames: readonly string[],
): ViewInfo[] {
  const project = makeProject()
  const application = resolveApplicationEntry(root)
  const applicationFiles = application === null ? [] : [application]
  const sources = [...new Set([...listSourceFiles(join(root, 'views')), ...applicationFiles])]
    .map((file) => addSource(project, file))
    .filter((source): source is SourceFile => source !== null)
  const views: ViewInfo[] = []

  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const frontendName = callName(call)
      if (frontendName !== 'defineFrontend') continue
      const input = objectValue(call.getArguments()[0], source)
      if (!input) continue
      const routes = objectValue(objectProperty(input, 'routes', source) ?? undefined, source)
      const declared = new Map<string, string>()
      if (routes && Node.isObjectLiteralExpression(routes)) {
        for (const property of routes.getProperties()) {
          const slug = propertySlug(property)
          const routeValue = propertyValue(property, source)
          if (!slug || !routeValue) continue
          const direct = literalString(routeValue, source)
          const routeInput = objectValue(routeValue, source)
          const path =
            direct ??
            (routeInput
              ? literalString(objectProperty(routeInput, 'path', source) ?? undefined, source)
              : undefined)
          if (path) declared.set(slug, path)
        }
      }
      const frontend = frontendSource(input, source)

      for (const slug of canonicalViewNames) {
        const path = declared.get(slug) ?? defaultRoute(slug)
        const url = frontend.externalOrigin
          ? new URL(path, `${frontend.externalOrigin}/`).toString()
          : undefined
        views.push({
          slug,
          kind: 'spa',
          ...(url ? { url } : { mount: path }),
          file: relative(root, source.getFilePath()).replaceAll('\\', '/'),
        })
      }
    }
  }
  return views
}
