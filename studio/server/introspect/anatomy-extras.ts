/**
 * anatomy-extras.ts — views / functions / client tree / env fields extraction.
 *
 * Pure static parsing only — domain TS is NEVER executed. Current Views are
 * joined from schema `view(...)` declarations and frontend route artifacts;
 * legacy `defineView` registries remain supported. The client tree is a shallow
 * readdir + best-effort ROUTES parse; env fields come from a ts-morph pass over
 * the exported `Env` interface. Every entry point is defensive: missing
 * files/dirs yield safe empties, never throws.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { InterfaceDeclaration, Node, Project, type SourceFile, SyntaxKind } from 'ts-morph'

import type { ClientTree, EnvField, ViewInfo } from '../../shared/types'

// ───────────────────────────── small fs helpers ─────────────────────────────

function readTextSafe(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => {
        try {
          return statSync(join(dir, e)).isFile()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => {
        try {
          return statSync(join(dir, e)).isDirectory()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

const SOURCE_FILE = /\.[cm]?[jt]sx?$/
const SKIP_SOURCE_DIRS = new Set(['__tests__', 'node_modules', '.git', '.astrale', '.dist', 'dist'])

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  const walk = (current: string) => {
    let entries: string[]
    try {
      entries = readdirSync(current).sort()
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_SOURCE_DIRS.has(entry)) continue
      const file = join(current, entry)
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(file)
      else if (
        stat.isFile() &&
        SOURCE_FILE.test(entry) &&
        !entry.endsWith('.d.ts') &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)
      ) {
        files.push(file)
      }
    }
  }
  walk(dir)
  return files
}

/** A throwaway in-memory ts-morph project (no tsconfig, no type-checking IO). */
function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true },
  })
}

function addSource(project: Project, file: string): SourceFile | null {
  try {
    return project.getSourceFile(file) ?? project.addSourceFileAtPath(file)
  } catch {
    return null
  }
}

function unwrap(node: Node): Node {
  let current = node
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression()
  }
  return current
}

function localValue(
  node: Node | undefined,
  source: SourceFile,
  seen = new Set<string>(),
): Node | null {
  if (!node) return null
  const value = unwrap(node)
  if (!Node.isIdentifier(value)) return value
  const key = `${source.getFilePath()}:${value.getText()}`
  if (seen.has(key)) return value
  seen.add(key)
  const init = source.getVariableDeclaration(value.getText())?.getInitializer()
  return init ? localValue(init, source, seen) : value
}

function objectValue(node: Node | undefined, source: SourceFile): Node | null {
  const value = localValue(node, source)
  return value && Node.isObjectLiteralExpression(value) ? value : null
}

function objectProperty(object: Node, name: string, source: SourceFile): Node | null {
  if (!Node.isObjectLiteralExpression(object)) return null
  for (const property of object.getProperties()) {
    if (Node.isPropertyAssignment(property) && property.getName() === name) {
      return localValue(property.getInitializer(), source)
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === name) {
      return localValue(property.getNameNode(), source)
    }
  }
  return null
}

function literalString(node: Node | undefined, source: SourceFile): string | undefined {
  const value = localValue(node, source)
  if (!value) return undefined
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
    return value.getLiteralValue()
  }
  return undefined
}

function callName(node: Node | null): string | undefined {
  if (!node || !Node.isCallExpression(node)) return undefined
  const expression = node.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText()
  if (Node.isPropertyAccessExpression(expression)) return expression.getName()
  return undefined
}

function propertySlug(property: Node): string | undefined {
  if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
    return undefined
  }
  const name = property.getNameNode()
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) {
    return name.getLiteralValue()
  }
  return property.getName()
}

function propertyValue(property: Node, source: SourceFile): Node | null {
  if (Node.isPropertyAssignment(property)) return localValue(property.getInitializer(), source)
  if (Node.isShorthandPropertyAssignment(property)) {
    return localValue(property.getNameNode(), source)
  }
  return null
}

/** Strip the leading-JSDoc decorations to a single trimmed line of prose. */
function cleanDoc(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim()
    .replace(/\s*\n\s*/g, ' ')
    .trim()
  return text.length ? text : undefined
}

// ──────────────────────────────── 1) views ────────────────────────────────

export interface SchemaDefinitionLocation {
  origin: string
  file: string
  line: number
}

function schemaProject(root: string, schemaDirName: string): SourceFile[] {
  const project = makeProject()
  return listSourceFiles(join(root, schemaDirName))
    .map((file) => addSource(project, file))
    .filter((source): source is SourceFile => source !== null)
}

function defineSchemaCalls(source: SourceFile) {
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const expression = call.getExpression()
    return (
      (Node.isIdentifier(expression) && expression.getText() === 'defineSchema') ||
      (Node.isPropertyAccessExpression(expression) && expression.getName() === 'defineSchema')
    )
  })
}

/**
 * Find the accepted schema without importing it. Current project roots are
 * barrels, so all authored schema modules are inspected and local origin
 * constants such as `defineSchema(ORIGIN, ...)` are resolved.
 */
export function findSchemaDefinition(
  root: string,
  schemaDirName = 'schema',
): SchemaDefinitionLocation | null {
  for (const source of schemaProject(root, schemaDirName)) {
    for (const call of defineSchemaCalls(source)) {
      const origin = literalString(call.getArguments()[0], source)
      if (!origin) continue
      const statement = call.getFirstAncestorByKind(SyntaxKind.VariableStatement)
      return {
        origin,
        file: source.getFilePath(),
        line: statement?.getStartLineNumber() ?? call.getStartLineNumber(),
      }
    }
  }
  return null
}

/**
 * Resolve the relative `./welcome` / `../foo` import spec used in views/index.ts
 * to an on-disk `.ts` file under the views dir. Returns absolute path or null.
 */
function resolveLocalModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = join(dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

function buildLegacyViews(root: string): ViewInfo[] {
  const indexFile = join(root, 'views', 'index.ts')
  if (!existsSync(indexFile)) return []

  let project: Project
  let index
  try {
    project = makeProject()
    index = project.addSourceFileAtPath(indexFile)
  } catch {
    return []
  }

  // Map identifier name → imported module spec (e.g. `welcome` → './welcome').
  const importSpecByName = new Map<string, string>()
  for (const imp of index.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    for (const named of imp.getNamedImports()) {
      importSpecByName.set(named.getAliasNode()?.getText() ?? named.getName(), spec)
    }
    const def = imp.getDefaultImport()
    if (def) importSpecByName.set(def.getText(), spec)
  }

  // Find the exported `views` object literal: { welcome, 'ui-status-page': statusPage }.
  const viewsDecl =
    index.getVariableDeclaration('views') ??
    index.getVariableDeclarations().find((d) => d.getName() === 'views')
  const init = viewsDecl?.getInitializer()
  if (!init || !Node.isObjectLiteralExpression(init)) return []

  const views: ViewInfo[] = []
  for (const prop of init.getProperties()) {
    let slug: string | undefined
    let refName: string | undefined
    let inlineArg: Node | undefined // `slug: defineView({...})` declared right here (e.g. mcac)

    if (Node.isShorthandPropertyAssignment(prop)) {
      // `welcome,` → slug `welcome`, ref `welcome` (imported view file)
      slug = prop.getName()
      refName = prop.getName()
    } else if (Node.isPropertyAssignment(prop)) {
      const nameNode = prop.getNameNode()
      slug = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : prop.getName()
      const valueInit = prop.getInitializer()
      if (
        valueInit &&
        Node.isCallExpression(valueInit) &&
        valueInit.getExpression().getText() === 'defineView'
      ) {
        // `'ui-move': defineView({...})` — parsed in place
        inlineArg = valueInit.getArguments()[0]
      } else if (valueInit && Node.isIdentifier(valueInit)) {
        // `'ui-status-page': statusPage` — resolved from an imported file
        refName = valueInit.getText()
      }
    }

    if (!slug) continue

    const info: ViewInfo = { slug, kind: 'unknown', url: undefined }

    if (inlineArg) {
      // inline defineView (e.g. mcac) — the declaration lives in views/index.ts itself
      info.file = relative(root, indexFile)
      applyParsed(info, parseViewObject(inlineArg))
    } else {
      // A shorthand may reference a defineView declared earlier in this same
      // registry file (services), or one imported from another module (ai-gateway).
      const localInit = refName
        ? index.getVariableDeclaration(refName)?.getInitializer()
        : undefined
      if (
        localInit &&
        Node.isCallExpression(localInit) &&
        localInit.getExpression().getText() === 'defineView'
      ) {
        const arg = localInit.getArguments()[0]
        if (arg) {
          info.file = relative(root, indexFile)
          applyParsed(info, parseViewObject(arg))
        }
      } else {
        const spec = refName ? importSpecByName.get(refName) : undefined
        const viewFile = spec ? resolveLocalModule(indexFile, spec) : null
        if (viewFile) {
          info.file = relative(root, viewFile)
          try {
            applyParsed(info, parseViewFile(project, viewFile))
          } catch {
            /* keep the unknown-kind stub */
          }
        }
      }
    }

    views.push(info)
  }

  return views
}

interface ParsedView {
  kind: ViewInfo['kind']
  auth?: string
  mount?: string
  viewFor?: string | string[]
  description?: string
}

/** Copy a ParsedView's set fields onto a ViewInfo. */
function applyParsed(info: ViewInfo, parsed: ParsedView): void {
  info.kind = parsed.kind
  if (parsed.auth !== undefined) info.auth = parsed.auth
  if (parsed.mount !== undefined) info.mount = parsed.mount
  if (parsed.viewFor !== undefined) info.viewFor = parsed.viewFor
  if (parsed.description !== undefined) info.description = parsed.description
}

/** Parse a referenced view module: find its defineView({...}) call + parse the literal. */
function parseViewFile(project: Project, file: string): ParsedView {
  const sf = project.addSourceFileAtPathIfExists(file) ?? project.addSourceFileAtPath(file)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === 'defineView') {
      const arg = call.getArguments()[0]
      if (arg) return parseViewObject(arg)
    }
  }
  return { kind: 'unknown' }
}

/** Parse a `defineView({...})` object-literal argument into a ParsedView. */
function parseViewObject(arg: Node): ParsedView {
  const result: ParsedView = { kind: 'unknown' }
  if (!Node.isObjectLiteralExpression(arg)) return result

  let hasRender = false
  let hasInlineHtml = false
  let hasMount = false

  for (const prop of arg.getProperties()) {
    if (
      !Node.isPropertyAssignment(prop) &&
      !Node.isMethodDeclaration(prop) &&
      !Node.isShorthandPropertyAssignment(prop)
    ) {
      continue
    }
    const key = prop.getName?.()
    if (!key) continue

    if (key === 'auth') {
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v && Node.isStringLiteral(v)) result.auth = v.getLiteralValue()
        else if (v) result.auth = v.getText().replace(/^['"`]|['"`]$/g, '')
      }
    } else if (key === 'mount') {
      hasMount = true
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v && Node.isStringLiteral(v)) result.mount = v.getLiteralValue()
        else if (v) result.mount = v.getText().replace(/^['"`]|['"`]$/g, '')
      }
    } else if (key === 'render') {
      hasRender = true
      // Inline HTML if the render body references c.html(...) or returns an HTML string.
      const text = prop.getText()
      if (/\bc\s*\.\s*html\s*\(/.test(text) || /<!doctype html>|<html\b/i.test(text)) {
        hasInlineHtml = true
      }
    } else if (key === 'viewFor') {
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v) {
          // selfOf(A) → 'A' ; [selfOf(A), selfOf(B)] → ['A','B'] ; else best-effort identifier.
          const names = [...v.getText().matchAll(/selfOf\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map(
            (m) => m[1],
          )
          if (names.length > 1) result.viewFor = names
          else if (names.length === 1) result.viewFor = names[0]
          else if (Node.isIdentifier(v)) result.viewFor = v.getText()
        }
      }
    } else if (key === 'description') {
      if (Node.isPropertyAssignment(prop)) {
        const v = prop.getInitializer()
        if (v && Node.isStringLiteral(v)) result.description = v.getLiteralValue()
      }
    }
  }

  if (hasRender && (hasInlineHtml || !hasMount)) result.kind = 'inline-html'
  else if (hasMount) result.kind = 'spa'
  else result.kind = 'unknown'

  return result
}

// ───────────────────────────── 2) client tree ─────────────────────────────

// Current SDK View declarations and frontend routes complete the View section.
function modernTargetNames(node: Node | null, source: SourceFile): string[] {
  if (!node) return []
  const value = localValue(node, source)
  if (!value) return []
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return []
  if (Node.isArrayLiteralExpression(value)) {
    return value.getElements().flatMap((entry) => modernTargetNames(entry, source))
  }
  if (Node.isIdentifier(value)) return [value.getText()]
  if (Node.isPropertyAccessExpression(value)) return [value.getText()]
  if (Node.isCallExpression(value) && callName(value) === 'selfOf') {
    return value.getArguments().flatMap((entry) => modernTargetNames(entry, source))
  }
  return []
}

function buildSchemaViews(root: string, schemaDirName: string): ViewInfo[] {
  const views: ViewInfo[] = []
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
          !slug ||
          !declaration ||
          callName(declaration) !== 'view' ||
          !Node.isCallExpression(declaration)
        ) {
          continue
        }
        const config = objectValue(declaration.getArguments()[0], source)
        const info: ViewInfo = {
          slug,
          kind: 'unknown',
          auth: config
            ? (literalString(objectProperty(config, 'auth', source) ?? undefined, source) ??
              'required')
            : 'required',
          url: undefined,
          file: relative(root, source.getFilePath()).replaceAll('\\', '/'),
        }
        if (config) {
          const description = literalString(
            objectProperty(config, 'description', source) ?? undefined,
            source,
          )
          const targets = modernTargetNames(objectProperty(config, 'target', source), source)
          if (description) info.description = description
          if (targets.length === 1) info.viewFor = targets[0]
          else if (targets.length > 1) info.viewFor = targets
        }
        views.push(info)
      }
    }
  }
  return views
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

function buildFrontendViews(root: string): ViewInfo[] {
  const project = makeProject()
  const sources = listSourceFiles(join(root, 'views'))
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

function mergeView(target: ViewInfo, incoming: ViewInfo, route: boolean): void {
  if (incoming.kind !== 'unknown') target.kind = incoming.kind
  if (incoming.auth !== undefined) target.auth = incoming.auth
  if (incoming.mount !== undefined) target.mount = incoming.mount
  if (incoming.url !== undefined) target.url = incoming.url
  if (incoming.viewFor !== undefined) target.viewFor = incoming.viewFor
  if (incoming.description !== undefined) target.description = incoming.description
  if (incoming.file && (route || !target.file)) target.file = incoming.file
}

/** Join legacy registries with current schema declarations and frontend routes. */
export function buildViews(root: string, schemaDirName = 'schema'): ViewInfo[] {
  const merged = new Map<string, ViewInfo>()
  for (const view of buildLegacyViews(root)) merged.set(view.slug, view)
  for (const view of buildSchemaViews(root, schemaDirName)) {
    const current = merged.get(view.slug)
    if (current) mergeView(current, view, false)
    else merged.set(view.slug, view)
  }
  for (const view of buildFrontendViews(root)) {
    const current = merged.get(view.slug)
    if (current) mergeView(current, view, true)
    else merged.set(view.slug, view)
  }
  return [...merged.values()]
}

// Client tree parsing starts here after the current View join above.
const RESERVED_CLIENT_DIRS = new Set(['shell', 'ui', 'views'])

export function buildClientTree(
  root: string,
  clientDir: string | null = join(root, 'client'),
): ClientTree {
  // Current SDK projects own presentation modules directly under ui/. Legacy
  // projects still point at a client package whose authored tree is client/src.
  const srcDir = clientDir
    ? join(clientDir, 'src')
    : existsSync(join(root, 'ui'))
      ? join(root, 'ui')
      : ''
  if (!existsSync(srcDir)) {
    return { shell: [], features: [], routes: {}, present: false }
  }

  const shell = listFiles(join(srcDir, 'shell'))

  const features = listDirs(srcDir)
    .filter((d) => !RESERVED_CLIENT_DIRS.has(d))
    .map((name) => ({ name, files: listFiles(join(srcDir, name)) }))

  const routes = parseRoutes(
    listFiles(srcDir)
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map((file) => join(srcDir, file)),
  )

  return { shell, features, routes, present: true }
}

/**
 * Best-effort parse of top-level client route registries. Domains call these
 * maps ROUTES, VIEW_REGISTRY, or another local name; the stable contract is a
 * quoted `/ui/…` key pointing at a component identifier.
 */
function parseRoutes(files: string[]): Record<string, string> {
  const routes: Record<string, string> = {}
  for (const file of files) {
    const src = readTextSafe(file)
    const entryRe = /['"`](\/ui\/[^'"`]+)['"`]\s*:\s*([A-Za-z_$][\w$.]*)/g
    let match: RegExpExecArray | null
    while ((match = entryRe.exec(src)) !== null) {
      routes[match[1]] = match[2]
    }
  }
  return routes
}

// ───────────────────────────── 3) env fields ──────────────────────────────

const KNOWN_INFRA_FIELDS = new Set(['WORKER_URL', 'ASSETS', 'SELF', 'VIEW_DEV_URL'])

export function buildEnvFields(root: string): EnvField[] {
  const envFile = join(root, 'env.ts')
  if (!existsSync(envFile)) return []

  let project: Project
  let sf
  try {
    project = makeProject()
    sf = project.addSourceFileAtPath(envFile)
  } catch {
    return []
  }

  const iface: InterfaceDeclaration | undefined =
    sf.getInterface('Env') ?? sf.getInterfaces().find((i) => i.getName() === 'Env')
  if (!iface) return []

  const fields: EnvField[] = []
  for (const member of iface.getMembers()) {
    // Skip index signatures: `[key: string]: unknown`.
    if (Node.isIndexSignatureDeclaration(member)) continue
    if (!Node.isPropertySignature(member)) continue

    const name = member.getName()
    if (!name) continue

    const optional = member.hasQuestionToken()
    const doc = cleanDoc(member.getJsDocs()[0]?.getInnerText())

    const isInfra = KNOWN_INFRA_FIELDS.has(name)
    const secret = !isInfra

    const field: EnvField = { name, optional, secret }
    if (doc) field.doc = doc
    fields.push(field)
  }

  return fields
}
