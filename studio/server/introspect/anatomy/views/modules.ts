/**
 * The authored modules a frontend's entries import, and what each module-scope name stands for.
 * Modules are parsed once into one project, within bounds on their number and size; a module
 * the reading does not follow (the Domain's Schema, a package, an asset) stays opaque, and one
 * it cannot find or read is named, never guessed.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type ImportDeclaration,
  type SourceFile,
} from 'ts-morph'

import { isPackageImportSpecifier, resolvePackageImport } from '../../../domain/package-imports'
import { definitionKind } from '../../source-overlay/definitions'
import { firstExisting, unwrapExpression } from '../../source-overlay/project'
import { aliased, type FrontendBuild } from './entries'

/** Bounds of one frontend's reading: the modules it follows, and the size of one it reads. */
export const MAX_MODULES = 1000
export const MAX_MODULE_BYTES = 512 * 1024

/** Imports Vite serves as assets or transforms by query: no code the reading follows. */
const ASSET =
  /\.(?:css|scss|sass|less|styl|pcss|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|json|md|mdx|html?|txt|wasm|mp3|mp4|webm|ogg|wav)$/iu

/**
 * What a module specifier gives: an authored module, a value the reading does not follow (the
 * Domain's Schema or a package), an asset, or a module the reading cannot find or read; its
 * `reason` completes "imports `…`, ".
 */
export type Resolution =
  | { kind: 'module'; file: string }
  | { kind: 'opaque' }
  | { kind: 'asset' }
  | { kind: 'missing'; reason: string }

/**
 * What a module-scope name stands for: a declaration in an authored module (a unit of the
 * reading), a definition's `define…()(…)` call, a whole module (a namespace or a dynamic
 * import), or a value the reading does not follow.
 */
export type Target =
  | { kind: 'unit'; unit: Node }
  | { kind: 'definition'; call: CallExpression }
  | { kind: 'module'; file: string }
  | { kind: 'opaque' }

export interface ModuleGraph {
  project: Project
  modules: ReadonlyMap<string, SourceFile>
  /** each module's static imports that resolve to authored modules */
  staticImports: ReadonlyMap<string, readonly string[]>
  /** what a specifier written in a module gives */
  resolution(file: string, specifier: string): Resolution
  /** what `name`, exported by `file`, stands for */
  exported(file: string, name: string): Target[]
  /** what an import declaration's binding of `name` stands for */
  imported(declaration: ImportDeclaration, name: string): Target[]
  /** what a name a module declares or imports at module scope stands for */
  local(source: SourceFile, name: string): Target[]
}

interface GraphContext {
  domainRoot: string
  schemaDir: string
  build: FrontendBuild
}

/** The Domain's own package, which a sibling View package may import by name. */
interface OwnPackage {
  name: string
  exports: unknown
}

/** A fresh project that parses and binds modules without resolving or loading anything else. */
function moduleProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true, noResolve: true, jsx: 1 },
  })
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function within(dir: string, file: string): boolean {
  const path = relative(canonical(dir), canonical(file))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function readOwnPackage(domainRoot: string): OwnPackage | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(domainRoot, 'package.json'), 'utf8')) as {
      name?: unknown
      exports?: unknown
    }
    return typeof manifest.name === 'string'
      ? { name: manifest.name, exports: manifest.exports }
      : undefined
  } catch {
    return undefined
  }
}

/** The authored file a package `exports` entry names, by the conditions source tooling reads. */
function exportTarget(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = exportTarget(entry, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const conditions = value as Record<string, unknown>
  for (const condition of ['source', 'development', 'import', 'module', 'default', 'types']) {
    const found = exportTarget(conditions[condition], depth + 1)
    if (found) return found
  }
  return undefined
}

/** The entry of a package `exports` map for `subpath` (`.` or `./…`), by Node's shapes of it. */
function ownExport(exports: unknown, subpath: string): unknown {
  const keyed =
    exports !== null &&
    typeof exports === 'object' &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith('.'))
  if (keyed) return (exports as Record<string, unknown>)[subpath]
  return subpath === '.' ? exports : undefined
}

/** Every module specifier a module writes: static imports and re-exports, and literal `import()`s. */
function specifiersOf(source: SourceFile): { static: string[]; dynamic: string[] } {
  const statics: string[] = []
  for (const declaration of source.getImportDeclarations()) {
    if (!declaration.isTypeOnly()) statics.push(declaration.getModuleSpecifierValue())
  }
  for (const declaration of source.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue()
    if (specifier !== undefined && !declaration.isTypeOnly()) statics.push(specifier)
  }
  const dynamic: string[] = []
  if (source.getFullText().includes('import(')) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
      const argument = call.getArguments()[0]
      if (
        argument &&
        (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
      ) {
        dynamic.push(argument.getLiteralValue())
      }
    }
  }
  return { static: statics, dynamic }
}

/** A module-scope declaration as a target: a definition's call, or the declaration itself. */
export function declarationTarget(declaration: Node): Target {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer()
    const value = initializer && unwrapExpression(initializer)
    if (value && Node.isCallExpression(value) && definitionKind(value)) {
      return { kind: 'definition', call: value }
    }
  }
  return { kind: 'unit', unit: declaration }
}

/**
 * The module-scope declaration a declaration node belongs to, if it is one: a top-level
 * variable (or one of its destructured names), function, class or enum.
 */
export function moduleDeclaration(declaration: Node): Node | undefined {
  if (Node.isBindingElement(declaration)) {
    const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
    return variable ? moduleDeclaration(variable) : undefined
  }
  if (Node.isVariableDeclaration(declaration)) {
    return declaration.getVariableStatement()?.getParent() === declaration.getSourceFile()
      ? declaration
      : undefined
  }
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isClassDeclaration(declaration) ||
    Node.isEnumDeclaration(declaration)
  ) {
    return declaration.getParent() === declaration.getSourceFile() ? declaration : undefined
  }
  return undefined
}

/**
 * Parse the modules a frontend's entries import, transitively, within the bounds. The returned
 * graph resolves names across them on demand, once per name.
 */
export function readModuleGraph(entries: readonly string[], context: GraphContext): ModuleGraph {
  const project = moduleProject()
  const modules = new Map<string, SourceFile>()
  const staticImports = new Map<string, string[]>()
  const resolutions = new Map<string, Map<string, Resolution>>()
  const ownPackage = readOwnPackage(context.domainRoot)
  const refused = new Map<string, string>()

  const fileResolution = (file: string | undefined): Resolution => {
    if (!file) return { kind: 'missing', reason: 'which the reading cannot find' }
    if (file.split(sep).includes('node_modules') || within(context.schemaDir, file)) {
      return { kind: 'opaque' }
    }
    return admit(file)
      ? { kind: 'module', file }
      : { kind: 'missing', reason: refused.get(file) ?? 'which the reading cannot read' }
  }

  const resolveSpecifier = (from: string, specifier: string): Resolution => {
    if (specifier.includes('?') || ASSET.test(specifier)) return { kind: 'asset' }
    let target = specifier
    const alias = aliased(specifier, context.build.aliases)
    if (alias) {
      if (alias.result === undefined) {
        return { kind: 'missing', reason: 'through a Vite alias the reading cannot tell' }
      }
      target = alias.result
    } else if (specifier.startsWith('/')) {
      return fileResolution(firstExisting(join(context.build.root, specifier)))
    }
    if (isAbsolute(target)) return fileResolution(firstExisting(target))
    if (target.startsWith('.')) return fileResolution(firstExisting(resolve(dirname(from), target)))
    if (isPackageImportSpecifier(target)) {
      for (const mapped of resolvePackageImport(target, dirname(from))) {
        const file = firstExisting(mapped)
        if (file) return fileResolution(file)
      }
      return { kind: 'missing', reason: 'which no package `imports` map resolves' }
    }
    if (ownPackage && (target === ownPackage.name || target.startsWith(`${ownPackage.name}/`))) {
      const mapped = exportTarget(
        ownExport(ownPackage.exports, `.${target.slice(ownPackage.name.length)}`),
      )
      if (mapped === undefined) {
        return { kind: 'missing', reason: 'which the Domain package’s `exports` do not map' }
      }
      return fileResolution(firstExisting(resolve(context.domainRoot, mapped)))
    }
    return { kind: 'opaque' }
  }

  const resolution = (file: string, specifier: string): Resolution => {
    let held = resolutions.get(file)
    if (!held) {
      held = new Map()
      resolutions.set(file, held)
    }
    let found = held.get(specifier)
    if (!found) {
      found = resolveSpecifier(file, specifier)
      held.set(specifier, found)
    }
    return found
  }

  const queue: string[] = []
  function admit(file: string): boolean {
    if (modules.has(file)) return true
    if (refused.has(file)) return false
    if (modules.size >= MAX_MODULES) {
      refused.set(file, `past the ${MAX_MODULES} modules the reading follows`)
      return false
    }
    let size: number
    try {
      size = statSync(file).size
    } catch {
      refused.set(file, 'which the reading cannot read')
      return false
    }
    if (size > MAX_MODULE_BYTES) {
      refused.set(file, `larger than the ${MAX_MODULE_BYTES / 1024} KiB the reading reads`)
      return false
    }
    try {
      modules.set(file, project.getSourceFile(file) ?? project.addSourceFileAtPath(file))
    } catch {
      refused.set(file, 'which the reading cannot parse')
      return false
    }
    queue.push(file)
    return true
  }

  for (const entry of entries) admit(entry)
  // Parse every module first: the binder runs once over the whole set.
  while (queue.length > 0) {
    const file = queue.shift()!
    const source = modules.get(file)!
    const specifiers = specifiersOf(source)
    const statics: string[] = []
    for (const specifier of specifiers.static) {
      const found = resolution(file, specifier)
      if (found.kind === 'module') statics.push(found.file)
    }
    for (const specifier of specifiers.dynamic) resolution(file, specifier)
    staticImports.set(file, [...new Set(statics)])
  }

  const exportedTargets = new Map<string, Target[]>()
  const resolving = new Set<string>()

  const imported = (declaration: ImportDeclaration, name: string): Target[] => {
    const found = resolution(
      declaration.getSourceFile().getFilePath(),
      declaration.getModuleSpecifierValue(),
    )
    if (found.kind === 'module') return exported(found.file, name)
    return found.kind === 'opaque' ? [{ kind: 'opaque' }] : []
  }

  const reexported = (source: SourceFile, specifier: string, name: string): Target[] => {
    const found = resolution(source.getFilePath(), specifier)
    if (found.kind === 'module') return exported(found.file, name)
    return found.kind === 'opaque' ? [{ kind: 'opaque' }] : []
  }

  function local(source: SourceFile, name: string): Target[] {
    const variable = source.getVariableDeclaration(name)
    if (variable) return [declarationTarget(variable)]
    const declared =
      source.getFunction(name) ?? source.getClass(name) ?? source.getEnum(name) ?? undefined
    if (declared) return [{ kind: 'unit', unit: declared }]
    for (const declaration of source.getImportDeclarations()) {
      if (declaration.isTypeOnly()) continue
      if (declaration.getDefaultImport()?.getText() === name)
        return imported(declaration, 'default')
      const namespace = declaration.getNamespaceImport()
      if (namespace?.getText() === name) {
        const found = resolution(source.getFilePath(), declaration.getModuleSpecifierValue())
        return found.kind === 'module'
          ? [{ kind: 'module', file: found.file }]
          : found.kind === 'opaque'
            ? [{ kind: 'opaque' }]
            : []
      }
      for (const specifier of declaration.getNamedImports()) {
        if ((specifier.getAliasNode()?.getText() ?? specifier.getName()) !== name) continue
        return specifier.isTypeOnly() ? [] : imported(declaration, specifier.getName())
      }
    }
    return []
  }

  function exported(file: string, name: string): Target[] {
    const key = `${file}\0${name}`
    const held = exportedTargets.get(key)
    if (held) return held
    if (resolving.has(key)) return []
    resolving.add(key)
    const found = findExported(file, name)
    resolving.delete(key)
    exportedTargets.set(key, found)
    return found
  }

  function findExported(file: string, name: string): Target[] {
    const source = modules.get(file)
    if (!source) return []
    if (name === 'default') {
      const assignment = source.getExportAssignment((candidate) => !candidate.isExportEquals())
      if (assignment) return [{ kind: 'unit', unit: assignment }]
      const declared =
        source.getFunctions().find((fn) => fn.isDefaultExport()) ??
        source.getClasses().find((cls) => cls.isDefaultExport())
      if (declared) return [{ kind: 'unit', unit: declared }]
    } else {
      const variable = source.getVariableDeclaration(name)
      if (variable?.isExported()) return [declarationTarget(variable)]
      const declared = source.getFunction(name) ?? source.getClass(name) ?? source.getEnum(name)
      if (declared?.isExported()) return [{ kind: 'unit', unit: declared }]
    }
    const stars: string[] = []
    for (const declaration of source.getExportDeclarations()) {
      if (declaration.isTypeOnly()) continue
      const specifier = declaration.getModuleSpecifierValue()
      const namespace = declaration.getNamespaceExport()
      if (namespace) {
        if (namespace.getName() !== name || specifier === undefined) continue
        const found = resolution(file, specifier)
        return found.kind === 'module'
          ? [{ kind: 'module', file: found.file }]
          : found.kind === 'opaque'
            ? [{ kind: 'opaque' }]
            : []
      }
      const named = declaration.getNamedExports()
      if (named.length === 0) {
        if (specifier !== undefined) stars.push(specifier)
        continue
      }
      for (const exportSpecifier of named) {
        if (exportSpecifier.isTypeOnly()) continue
        const exposed = exportSpecifier.getAliasNode()?.getText() ?? exportSpecifier.getName()
        if (exposed !== name) continue
        const original = exportSpecifier.getName()
        return specifier === undefined
          ? local(source, original)
          : reexported(source, specifier, original)
      }
    }
    for (const specifier of stars) {
      const found = reexported(source, specifier, name)
      if (found.length > 0) return found
    }
    return []
  }

  return { project, modules, staticImports, resolution, exported, imported, local }
}

/** Every module-scope declaration of a module, as targets: what a whole-module use reaches. */
export function moduleTargets(graph: ModuleGraph, file: string): Target[] {
  const source = graph.modules.get(file)
  if (!source) return []
  const targets: Target[] = [{ kind: 'unit', unit: source }]
  for (const statement of source.getStatements()) {
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        targets.push(declarationTarget(declaration))
      }
    } else if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isEnumDeclaration(statement) ||
      (Node.isExportAssignment(statement) && !statement.isExportEquals())
    ) {
      targets.push({ kind: 'unit', unit: statement })
    } else if (Node.isExportDeclaration(statement) && !statement.isTypeOnly()) {
      const specifier = statement.getModuleSpecifierValue()
      const found = specifier === undefined ? undefined : graph.resolution(file, specifier)
      if (found?.kind === 'module') targets.push({ kind: 'module', file: found.file })
    }
  }
  return targets
}
