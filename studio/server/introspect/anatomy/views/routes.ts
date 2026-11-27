import { join } from 'node:path'
import { Node, type SourceFile, SyntaxKind } from 'ts-morph'

import type { ViewInfo } from '../../../../shared/contracts/schema'

import { resolveDomainEntry } from '../../../domain/registry'
import { resolveImportedValue } from '../../source-overlay/project'
import { defineSchemaCalls } from '../schema-definition'
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
  relativePosix,
} from '../source'

/** Locate authored declarations for canonical View keys without projecting any semantics. */
export function buildSchemaViewSources(
  root: string,
  schemaSources: readonly SourceFile[],
): Map<string, string> {
  const sources = new Map<string, string>()
  for (const source of schemaSources) {
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
          sources.set(slug, relativePosix(root, source.getFilePath()))
        }
      }
    }
  }
  return sources
}

export function defaultRoute(name: string): string {
  return `/${name
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[_\s]+/gu, '-')
    .toLowerCase()}`
}

/**
 * Where a frontend's browser code comes from, as its `source` declares it: a Vite build of the
 * Domain's own sources (`config` is undefined when the call names none, null when it names one
 * the reading cannot tell), an `external` origin (undefined when the reading cannot tell it),
 * or a value the reading cannot tell.
 */
export type FrontendSource =
  | { kind: 'vite'; config?: string | null }
  | { kind: 'external'; origin?: string }
  | { kind: 'unknown' }

/** One View's route as written: a missing part takes the SDK default, null cannot be told. */
export interface FrontendRouteInput {
  path?: string | null
  document?: string | null
}

/** A `defineFrontend` call: where it is written, its source and the routes it writes. */
export interface FrontendDeclaration {
  /** absolute path of the declaring module */
  file: string
  line: number
  source: FrontendSource
  routes: ReadonlyMap<string, FrontendRouteInput>
}

/** A string written as a literal, as a local constant, or as a constant a named import exports. */
function stringValue(node: Node | undefined, source: SourceFile): string | undefined {
  const local = literalString(node, source)
  if (local !== undefined || !node || !Node.isIdentifier(node)) return local
  const imported = resolveImportedValue(node)
  return imported ? literalString(imported, imported.getSourceFile()) : undefined
}

/** A route property the reading reads: absent, a string it can tell, or null. */
function routePart(input: Node, name: string, source: SourceFile): string | null | undefined {
  const value = objectProperty(input, name, source)
  if (!value) return undefined
  return stringValue(value, source) ?? null
}

function frontendSource(input: Node, source: SourceFile): FrontendSource {
  const value = objectProperty(input, 'source', source)
  if (!value || !Node.isCallExpression(value)) return { kind: 'unknown' }
  const name = callName(value)
  const argument = value.getArguments()[0]
  if (name === 'external') {
    const origin = stringValue(argument, source)
    return origin === undefined ? { kind: 'external' } : { kind: 'external', origin }
  }
  if (name !== 'vite') return { kind: 'unknown' }
  if (!argument) return { kind: 'vite' }
  const options = objectValue(argument, source)
  if (!options) return { kind: 'vite', config: null }
  const config = routePart(options, 'config', source)
  return config === undefined ? { kind: 'vite' } : { kind: 'vite', config }
}

function frontendRoutes(input: Node, source: SourceFile): Map<string, FrontendRouteInput> {
  const routes = objectValue(objectProperty(input, 'routes', source) ?? undefined, source)
  const declared = new Map<string, FrontendRouteInput>()
  if (!routes || !Node.isObjectLiteralExpression(routes)) return declared
  for (const property of routes.getProperties()) {
    const slug = propertySlug(property)
    const routeValue = propertyValue(property, source)
    if (!slug || !routeValue) continue
    const direct = stringValue(routeValue, source)
    const routeInput = objectValue(routeValue, source)
    if (direct !== undefined) declared.set(slug, { path: direct })
    else if (routeInput) {
      const path = routePart(routeInput, 'path', source)
      const document = routePart(routeInput, 'document', source)
      declared.set(slug, {
        ...(path === undefined ? {} : { path }),
        ...(document === undefined ? {} : { document }),
      })
    } else declared.set(slug, { path: null, document: null })
  }
  return declared
}

/** Every `defineFrontend` call in `views/**` and the Domain module, statically parsed. */
export function readFrontends(root: string): FrontendDeclaration[] {
  const project = makeProject()
  const domainFile = resolveDomainEntry(root)
  const domainFiles = domainFile === null ? [] : [domainFile]
  const sources = [...new Set([...listSourceFiles(join(root, 'views')), ...domainFiles])]
    .map((file) => addSource(project, file))
    .filter((source): source is SourceFile => source !== null)
  const frontends: FrontendDeclaration[] = []
  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (callName(call) !== 'defineFrontend') continue
      const input = objectValue(call.getArguments()[0], source)
      if (!input) continue
      frontends.push({
        file: source.getFilePath(),
        line: call.getStartLineNumber(),
        source: frontendSource(input, source),
        routes: frontendRoutes(input, source),
      })
    }
  }
  return frontends
}

/** The route's URL under an external origin; undefined when the origin is no URL. */
function urlOf(path: string, origin: string): string | undefined {
  try {
    return new URL(path, `${origin}/`).toString()
  } catch {
    return undefined
  }
}

export function buildFrontendViews(
  root: string,
  canonicalViewNames: readonly string[],
  frontends: readonly FrontendDeclaration[] = readFrontends(root),
): ViewInfo[] {
  const views: ViewInfo[] = []
  for (const frontend of frontends) {
    const file = relativePosix(root, frontend.file)
    const origin = frontend.source.kind === 'external' ? frontend.source.origin : undefined
    for (const slug of canonicalViewNames) {
      const path = frontend.routes.get(slug)?.path ?? defaultRoute(slug)
      const url = origin ? urlOf(path, origin) : undefined
      views.push({
        slug,
        kind: 'spa',
        ...(url ? { url } : { mount: path }),
        file,
      })
    }
  }
  return views
}
