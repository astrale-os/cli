import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Node, type SourceFile, SyntaxKind } from 'ts-morph'

import type { ViewInfo } from '../../../../shared/types'

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

function frontendKind(
  frontendName: string,
  input: Node,
  source: SourceFile,
): { kind: ViewInfo['kind']; external: boolean } {
  if (frontendName === 'reactFrontend') return { kind: 'spa', external: false }
  const sourceName = callName(objectProperty(input, 'source', source))
  if (sourceName === 'generatedFrontend') return { kind: 'inline-html', external: false }
  if (sourceName === 'viteFrontend' || sourceName === 'prebuiltFrontend') {
    return { kind: 'spa', external: false }
  }
  if (sourceName === 'externalFrontend') return { kind: 'spa', external: true }
  return { kind: 'unknown', external: false }
}

export function buildFrontendViews(root: string): ViewInfo[] {
  const project = makeProject()
  const compositionFiles = ['implementation.ts', 'domain.ts']
    .map((file) => join(root, file))
    .filter((file) => existsSync(file))
  const sources = [...new Set([...listSourceFiles(join(root, 'views')), ...compositionFiles])]
    .map((file) => addSource(project, file))
    .filter((source): source is SourceFile => source !== null)
  const views: ViewInfo[] = []

  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const frontendName = callName(call)
      if (frontendName !== 'frontendArtifact' && frontendName !== 'reactFrontend') continue
      const input = objectValue(call.getArguments()[0], source)
      if (!input) continue
      const routes = objectValue(objectProperty(input, 'routes', source) ?? undefined, source)
      if (!routes || !Node.isObjectLiteralExpression(routes)) continue
      const artifact = frontendKind(frontendName, input, source)

      for (const property of routes.getProperties()) {
        const slug = propertySlug(property)
        const routeValue = propertyValue(property, source)
        if (!slug || !routeValue) continue
        const routeName = callName(routeValue)
        const routeInput = Node.isCallExpression(routeValue)
          ? objectValue(routeValue.getArguments()[0], source)
          : objectValue(routeValue, source)
        if (!routeInput) continue

        const path = literalString(objectProperty(routeInput, 'path', source) ?? undefined, source)
        const href = literalString(objectProperty(routeInput, 'href', source) ?? undefined, source)
        views.push({
          slug,
          kind: routeName === 'reactRoute' ? 'spa' : artifact.kind,
          ...(href ? { url: href } : { url: undefined }),
          ...(!href && (path || !artifact.external) ? { mount: path ?? `/ui/${slug}` } : {}),
          file: relative(root, source.getFilePath()).replaceAll('\\', '/'),
        })
      }
    }
  }
  return views
}
