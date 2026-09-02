/** SDK V1 project discovery and the in-process Studio registry. */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph'

import { isPackageImportSpecifier, resolvePackageImport } from './package-imports'

export interface DomainHandle {
  readonly id: string
  readonly root: string
  readonly configFile: string
  readonly applicationFile: string
  readonly schemaDirName: string
  readonly schemaDir: string
  readonly schemaIndex: string
  origin?: string
}

const registry = new Map<string, DomainHandle>()

export function makeId(root: string): string {
  return basename(resolve(root)).replace(/[^a-zA-Z0-9_-]/g, '-') || 'domain'
}

/**
 * The module that composes a domain, and the factory it calls.
 *
 * Both changed with the SDK — an `application.ts` calling `defineApplication`
 * became a `domain.ts` calling `defineDomain` — and both shapes are in the wild:
 * a workspace holds domains scaffolded months apart, and `create-astrale-domain`
 * only ever emits the current one. Studio reads either, in the order below, so a
 * freshly scaffolded domain is discovered like any other.
 */
const COMPOSITION_MODULES: readonly string[] = ['application', 'domain']
const COMPOSITION_FACTORIES: readonly { module: string; name: string }[] = [
  { module: '@astrale-os/sdk/application', name: 'defineApplication' },
  { module: '@astrale-os/sdk', name: 'defineApplication' },
  { module: '@astrale-os/sdk', name: 'defineDomain' },
]

/** Resolve the composition module imported by config, with the root file as convention. */
export function resolveApplicationEntry(root: string): string | null {
  const project = resolve(root)
  for (const name of COMPOSITION_MODULES) {
    const conventional = join(project, `${name}.ts`)
    if (existsSync(conventional)) return conventional
  }
  const config = join(project, 'astrale.config.ts')
  if (!existsSync(config)) return null
  let source: string
  try {
    source = readFileSync(config, 'utf8')
  } catch {
    return null
  }
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
    const specifier = match[1]
    if (
      !specifier?.startsWith('.') ||
      !COMPOSITION_MODULES.includes(basename(specifier).replace(/\.[^.]+$/u, ''))
    ) {
      continue
    }
    const selected = resolveSourceFile(project, specifier)
    if (selected !== null) return selected
  }
  return null
}

/**
 * Resolve the authored Schema module selected by the composition's `schema` binding.
 *
 * Application is the composition source of truth, but importing it would also load
 * Runtime, Frontend, integrations, and any authored top-level effects. Studio follows
 * the Schema binding statically instead, then imports only that module in its isolated
 * extractor subprocess.
 */
export function resolveSchemaEntry(root: string, applicationFile: string): string | null {
  const project = resolve(root)
  const source = addSourceFile(applicationFile)
  if (source === null) return null

  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isCompositionCall(call, source)) continue
    const input = resolveLocalValue(call.getArguments()[0], source)
    if (!input || !Node.isObjectLiteralExpression(input)) continue
    const schema = objectPropertyValue(input, 'schema')
    if (!schema) continue
    const selected = schemaModuleOf(schema, source, project)
    if (selected !== null) return selected
  }
  return null
}

export function isDomainDir(root: string): boolean {
  const project = resolve(root)
  if (!existsSync(join(project, 'astrale.config.ts'))) return false
  const application = resolveApplicationEntry(project)
  return application !== null && resolveSchemaEntry(project, application) !== null
}

export function registerDomain(root: string): DomainHandle | null {
  const project = resolve(root)
  const applicationFile = resolveApplicationEntry(project)
  if (applicationFile === null || !existsSync(join(project, 'astrale.config.ts'))) return null
  const schemaIndex = resolveSchemaEntry(project, applicationFile)
  if (schemaIndex === null) return null
  const schemaDir = dirname(schemaIndex)
  const handle: DomainHandle = {
    id: makeId(project),
    root: project,
    configFile: join(project, 'astrale.config.ts'),
    applicationFile,
    schemaDirName: relative(project, schemaDir).replaceAll('\\', '/') || '.',
    schemaDir,
    schemaIndex,
  }
  const current = registry.get(handle.id)
  if (
    current?.root === handle.root &&
    current.configFile === handle.configFile &&
    current.applicationFile === handle.applicationFile &&
    current.schemaIndex === handle.schemaIndex
  ) {
    return current
  }
  registry.set(handle.id, handle)
  return handle
}

export function unregisterDomain(id: string): void {
  registry.delete(id)
}

export function getDomain(id: string): DomainHandle | undefined {
  return registry.get(id)
}

export function allDomains(): DomainHandle[] {
  return [...registry.values()]
}

/** Studio's current project model always requires the semantic SDK Schema facade. */
export function depsInstalled(root: string): boolean {
  if (existsSync(join(root, 'node_modules', '@astrale-os', 'sdk'))) return true
  try {
    Bun.resolveSync('@astrale-os/sdk/schema', root)
    return true
  } catch {
    return false
  }
}

function resolveSourceFile(root: string, specifier: string): string | null {
  return sourceCandidates(resolve(root, specifier)).find(isFile) ?? null
}

function addSourceFile(file: string): SourceFile | null {
  try {
    const project = new Project({
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      compilerOptions: { allowJs: true, allowImportingTsExtensions: true },
    })
    return project.addSourceFileAtPath(file)
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

function resolveLocalValue(
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
  const initializer = source.getVariableDeclaration(value.getText())?.getInitializer()
  return initializer ? resolveLocalValue(initializer, source, seen) : value
}

function isCompositionCall(call: CallExpression, source: SourceFile): boolean {
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) {
    const localName = expression.getText()
    return source
      .getImportDeclarations()
      .some((declaration) =>
        COMPOSITION_FACTORIES.some(
          (factory) =>
            declaration.getModuleSpecifierValue() === factory.module &&
            declaration
              .getNamedImports()
              .some(
                (named) =>
                  named.getName() === factory.name &&
                  (named.getAliasNode()?.getText() ?? named.getName()) === localName,
              ),
        ),
      )
  }
  if (!Node.isPropertyAccessExpression(expression)) return false
  const namespace = expression.getExpression()
  if (!Node.isIdentifier(namespace)) return false
  return source
    .getImportDeclarations()
    .some((declaration) =>
      COMPOSITION_FACTORIES.some(
        (factory) =>
          expression.getName() === factory.name &&
          declaration.getModuleSpecifierValue() === factory.module &&
          declaration.getNamespaceImport()?.getText() === namespace.getText(),
      ),
    )
}

function objectPropertyValue(object: ObjectLiteralExpression, name: string) {
  const property = object.getProperty(name)
  if (property && Node.isPropertyAssignment(property)) return property.getInitializer()
  if (property && Node.isShorthandPropertyAssignment(property)) return property.getNameNode()
  return undefined
}

function schemaModuleOf(node: Node, source: SourceFile, root: string): string | null {
  const value = unwrap(node)
  if (Node.isIdentifier(value)) {
    const initializer = source.getVariableDeclaration(value.getText())?.getInitializer()
    if (initializer) return schemaModuleOf(initializer, source, root)
    for (const declaration of source.getImportDeclarations()) {
      const imported = declaration
        .getNamedImports()
        .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === value.getText())
      const defaultImported = declaration.getDefaultImport()?.getText() === value.getText()
      if (imported || defaultImported) {
        return resolveAuthoredModule(root, source, declaration.getModuleSpecifierValue())
      }
    }
    return null
  }
  if (Node.isPropertyAccessExpression(value) && Node.isIdentifier(value.getExpression())) {
    const namespace = value.getExpression().getText()
    for (const declaration of source.getImportDeclarations()) {
      if (declaration.getNamespaceImport()?.getText() === namespace) {
        return resolveAuthoredModule(root, source, declaration.getModuleSpecifierValue())
      }
    }
  }
  return null
}

function resolveAuthoredModule(root: string, from: SourceFile, specifier: string): string | null {
  const fromDir = dirname(from.getFilePath())
  let candidates: string[] = []
  if (specifier.startsWith('.')) {
    candidates = sourceCandidates(resolve(fromDir, specifier))
  } else if (isPackageImportSpecifier(specifier)) {
    // Read the Domain's own `imports` map rather than asking the host resolver:
    // a compiled standalone cannot resolve an external package's aliases, and
    // rejected every Domain whose Application imports `#schema`.
    candidates = resolvePackageImport(specifier, fromDir).flatMap(sourceCandidates)
  } else {
    return null
  }
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue
    const rel = relative(root, candidate)
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
      continue
    }
    return candidate
  }
  return null
}

function sourceCandidates(file: string): string[] {
  const extension = extname(file)
  const sourceBase = /\.[cm]?jsx?$/u.test(extension) ? file.slice(0, -extension.length) : file
  return [
    file,
    `${sourceBase}.ts`,
    `${sourceBase}.tsx`,
    `${sourceBase}.mts`,
    `${sourceBase}.cts`,
    join(file, 'index.ts'),
    join(file, 'index.tsx'),
  ]
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}
