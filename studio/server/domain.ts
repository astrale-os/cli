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

const PROJECT_MODULES = new Set(['@astrale-os/sdk/project', '@astrale-os/sdk'])
const DEPLOYMENT_MODULES = new Set(['@astrale-os/sdk/deployment', '@astrale-os/sdk'])
const TESTING_MODULES = new Set(['@astrale-os/sdk/testing'])

/** What `astrale.config.ts` declares through `defineProject`, read statically. */
export interface ProjectConfigAnalysis {
  /** Application module of `deployment: deploy({ application })`, resolved to a source file. */
  readonly applicationFile: string | null
  /** Dataset module coordinates of `tests: tests({ datasets: [dataset('…')] })`, in order. */
  readonly datasets: readonly string[]
}

const NO_PROJECT: ProjectConfigAnalysis = Object.freeze({ applicationFile: null, datasets: [] })

/**
 * Read the Project declared by `astrale.config.ts` without executing it: the configuration is
 * the single entry point of a domain, but importing it would load the adapter, the Runtime
 * and every authored effect. Local `const` bindings are followed; dynamic constructions are
 * simply not seen.
 */
export function analyzeProjectConfig(root: string): ProjectConfigAnalysis {
  const project = resolve(root)
  const config = join(project, 'astrale.config.ts')
  if (!existsSync(config)) return NO_PROJECT
  const source = addSourceFile(config)
  if (source === null) return NO_PROJECT
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isSdkCall(call, source, 'defineProject', PROJECT_MODULES)) continue
    const input = resolveLocalValue(call.getArguments()[0], source)
    if (!input || !Node.isObjectLiteralExpression(input)) continue
    return Object.freeze({
      applicationFile: applicationOf(objectPropertyValue(input, 'deployment'), source, project),
      datasets: Object.freeze(datasetsOf(objectPropertyValue(input, 'tests'), source)),
    })
  }
  return NO_PROJECT
}

function applicationOf(node: Node | undefined, source: SourceFile, root: string): string | null {
  const deployment = resolveLocalValue(node, source)
  if (!deployment || !Node.isCallExpression(deployment)) return null
  if (!isSdkCall(deployment, source, 'deploy', DEPLOYMENT_MODULES)) return null
  const input = resolveLocalValue(deployment.getArguments()[0], source)
  if (!input || !Node.isObjectLiteralExpression(input)) return null
  const application = objectPropertyValue(input, 'application')
  return application ? importedModuleOf(application, source, root) : null
}

function datasetsOf(node: Node | undefined, source: SourceFile): string[] {
  const tests = resolveLocalValue(node, source)
  if (!tests || !Node.isCallExpression(tests)) return []
  if (!isSdkCall(tests, source, 'tests', TESTING_MODULES)) return []
  const input = resolveLocalValue(tests.getArguments()[0], source)
  if (!input || !Node.isObjectLiteralExpression(input)) return []
  const list = resolveLocalValue(objectPropertyValue(input, 'datasets'), source)
  if (!list || !Node.isArrayLiteralExpression(list)) return []
  const paths: string[] = []
  for (const element of list.getElements()) {
    const reference = resolveLocalValue(element, source)
    if (!reference || !Node.isCallExpression(reference)) continue
    if (!isSdkCall(reference, source, 'dataset', TESTING_MODULES)) continue
    const argument = reference.getArguments()[0]
    const literal = argument ? unwrap(argument) : undefined
    if (!literal) continue
    if (!Node.isStringLiteral(literal) && !Node.isNoSubstitutionTemplateLiteral(literal)) continue
    const path = literal.getLiteralValue()
    if (!paths.includes(path)) paths.push(path)
  }
  return paths
}

/** The module an identifier is imported from (named, aliased or default), resolved inside the root. */
function importedModuleOf(node: Node, source: SourceFile, root: string): string | null {
  const value = unwrap(node)
  if (!Node.isIdentifier(value)) return null
  const name = value.getText()
  for (const declaration of source.getImportDeclarations()) {
    const named = declaration
      .getNamedImports()
      .some((entry) => (entry.getAliasNode()?.getText() ?? entry.getName()) === name)
    if (named || declaration.getDefaultImport()?.getText() === name) {
      return resolveAuthoredModule(root, source, declaration.getModuleSpecifierValue())
    }
  }
  return null
}

/**
 * Resolve the composition module: the Project declared by `astrale.config.ts` first, then the
 * root `application.ts` / `domain.ts` convention, then the config's own composition import for
 * projects that predate `defineProject`.
 */
export function resolveApplicationEntry(root: string): string | null {
  const project = resolve(root)
  const declared = analyzeProjectConfig(project).applicationFile
  if (declared !== null) return declared
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

/** True when `call` invokes `name` imported (named, aliased or namespaced) from one of `modules`. */
function isSdkCall(
  call: CallExpression,
  source: SourceFile,
  name: string,
  modules: ReadonlySet<string>,
): boolean {
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) {
    const localName = expression.getText()
    return source
      .getImportDeclarations()
      .some(
        (declaration) =>
          modules.has(declaration.getModuleSpecifierValue()) &&
          declaration
            .getNamedImports()
            .some(
              (named) =>
                named.getName() === name &&
                (named.getAliasNode()?.getText() ?? named.getName()) === localName,
            ),
      )
  }
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== name) return false
  const namespace = expression.getExpression()
  if (!Node.isIdentifier(namespace)) return false
  return source
    .getImportDeclarations()
    .some(
      (declaration) =>
        modules.has(declaration.getModuleSpecifierValue()) &&
        declaration.getNamespaceImport()?.getText() === namespace.getText(),
    )
}

/** True when `call` invokes one of the composition factories a domain module may use. */
function isCompositionCall(call: CallExpression, source: SourceFile): boolean {
  return COMPOSITION_FACTORIES.some((factory) =>
    isSdkCall(call, source, factory.name, new Set([factory.module])),
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
