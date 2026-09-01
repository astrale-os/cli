/**
 * Tolerant ts-morph project construction and authored-source resolution.
 *
 * This module owns syntax/value lookup only. It does not interpret handlers or
 * schema members.
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph'

import { isPackageImportSpecifier, resolvePackageImport } from '../../package-imports'

/** A fresh, in-memory-ish ts-morph project: no tsconfig, tolerant of errors. */
export function newProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      // `allowImportingTsExtensions` keeps `.ts`-suffixed imports from blowing up.
      allowImportingTsExtensions: true,
    },
  })
}

/** Add a file to the project if it exists; returns undefined otherwise. */
export function tryAddFile(project: Project, file: string): SourceFile | undefined {
  try {
    if (!existsSync(file)) return undefined
    return project.getSourceFile(file) ?? project.addSourceFileAtPath(file)
  } catch {
    return undefined
  }
}

/** Path relative to `root`, POSIX-style ('schema/monitor.ts'), never absolute. */
export function relToRoot(root: string, file: string): string {
  const abs = isAbsolute(file) ? file : resolvePath(root, file)
  const canonical = (value: string) => {
    try {
      return realpathSync(value)
    } catch {
      return value
    }
  }
  return relative(canonical(root), canonical(abs)).split('\\').join('/')
}

/** The call's callee identifier name, e.g. `method` / `classMethods` / `todo`. */
export function calleeName(call: CallExpression): string | undefined {
  const expr = call.getExpression()
  if (Node.isIdentifier(expr)) return expr.getText()
  if (Node.isPropertyAccessExpression(expr)) return expr.getName()
  return undefined
}

/** Remove syntax-only wrappers around a runtime value. */
export function unwrapExpression(node: Node): Node {
  let current = node
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression()
  }
  return current
}

/** Resolve a local or relatively imported identifier to its runtime value. */
export function valueOfIdentifier(id: Node): Node | undefined {
  if (!Node.isIdentifier(id)) return undefined
  const decl = firstValueDeclaration(id)
  if (decl && Node.isVariableDeclaration(decl)) return decl.getInitializer()
  return resolveImportedValue(id)
}

/** Follow a named relative import to the exported value that defines it. */
function resolveImportedValue(id: Node): Node | undefined {
  if (!Node.isIdentifier(id)) return undefined
  const localName = id.getText()
  const sourceFile = id.getSourceFile()

  for (const imp of sourceFile.getImportDeclarations()) {
    for (const named of imp.getNamedImports()) {
      const local = named.getAliasNode()?.getText() ?? named.getName()
      if (local !== localName) continue
      const target = resolveModuleFile(sourceFile, imp.getModuleSpecifierValue())
      if (!target) return undefined
      return findExportedValue(id.getProject(), target, named.getName(), new Set<string>())
    }
  }
  return undefined
}

/** Find an exported variable/function value, following local and barrel exports. */
function findExportedValue(
  project: Project,
  file: string,
  exportName: string,
  seen: Set<string>,
): Node | undefined {
  const key = `${file}:${exportName}`
  if (seen.has(key)) return undefined
  seen.add(key)
  const sf = tryAddFile(project, file)
  if (!sf) return undefined

  const localValue = (name: string, exportedOnly: boolean): Node | undefined => {
    const variable = sf
      .getVariableDeclarations()
      .find(
        (candidate) => candidate.getName() === name && (!exportedOnly || candidate.isExported()),
      )
    if (variable) return variable.getInitializer()
    return sf
      .getFunctions()
      .find(
        (candidate) => candidate.getName() === name && (!exportedOnly || candidate.isExported()),
      )
  }

  const direct = localValue(exportName, true)
  if (direct) return direct

  for (const ex of sf.getExportDeclarations()) {
    const modSpec = ex.getModuleSpecifierValue()
    const target = modSpec ? resolveModuleFile(sf, modSpec) : undefined
    const named = ex.getNamedExports()
    if (named.length > 0) {
      for (const specifier of named) {
        const exposed = specifier.getAliasNode()?.getText() ?? specifier.getName()
        if (exposed !== exportName) continue
        const original = specifier.getName()
        if (target) return findExportedValue(project, target, original, seen)
        return localValue(original, false)
      }
    } else if (target) {
      const found = findExportedValue(project, target, exportName, seen)
      if (found) return found
    }
  }
  return undefined
}

/** Get the value node of an object-literal property (handles shorthand). */
export function getProp(obj: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  if (Node.isPropertyAssignment(prop)) return prop.getInitializer()
  if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode()
  if (Node.isMethodDeclaration(prop)) return prop
  return prop
}

/** First value/declaration node a name resolves to (definition, not reference). */
export function firstValueDeclaration(node: Node): Node | undefined {
  const idNode = Node.isIdentifier(node)
    ? node
    : node.getFirstDescendantByKind(SyntaxKind.Identifier)
  if (!idNode || !Node.isIdentifier(idNode)) return undefined
  const symbol = idNode.getSymbol()
  if (!symbol) return undefined
  const decls = symbol.getDeclarations()
  return decls[0]
}

/** Resolve a relative module specifier to a concrete .ts file path on disk. */
export function resolveModuleFile(from: SourceFile, spec: string): string | undefined {
  const baseDir = dirname(from.getFilePath())
  if (!spec.startsWith('.')) {
    // Current SDK projects use package `imports` aliases such as `#actions/risk`.
    // Read the project's own manifest rather than asking the host resolver: a
    // compiled standalone cannot resolve an external package's aliases at all.
    if (!isPackageImportSpecifier(spec)) return undefined
    for (const target of resolvePackageImport(spec, baseDir)) {
      const found = firstExisting(target)
      if (found) return found
    }
    return undefined
  }
  return firstExisting(resolvePath(baseDir, spec))
}

/** The authored file behind a module target, tolerating an emitted `.js` suffix. */
function firstExisting(base: string): string | undefined {
  const sourceBase = base.replace(/\.(?:[cm]?js|jsx)$/, '')
  const candidates = [
    base,
    sourceBase.endsWith('.ts') ? sourceBase : `${sourceBase}.ts`,
    sourceBase.endsWith('.tsx') ? sourceBase : `${sourceBase}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

/** Resolve a value to an object literal, following local/imported identifiers. */
export function resolveObjectLiteral(
  node: Node,
  seen = new Set<string>(),
): import('ts-morph').ObjectLiteralExpression | undefined {
  const value = unwrapExpression(node)
  const key = `${value.getSourceFile().getFilePath()}:${value.getStart()}`
  if (seen.has(key)) return undefined
  seen.add(key)
  if (Node.isObjectLiteralExpression(value)) return value
  if (Node.isIdentifier(value)) {
    const resolved = valueOfIdentifier(value)
    if (resolved) return resolveObjectLiteral(resolved, seen)
  }
  return undefined
}

/** Value carried by an object-literal property, including shorthand/method syntax. */
export function objectPropertyValue(prop: Node): Node | undefined {
  if (Node.isPropertyAssignment(prop)) return prop.getInitializer()
  if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode()
  if (Node.isMethodDeclaration(prop)) return prop
  return undefined
}

/** A string-literal property value, e.g. `as: 'page'` → 'page'. */
export function stringLiteralOfProp(obj: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined
  const v = prop.getInitializer()
  if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v)))
    return v.getLiteralText()
  return undefined
}

/** The key name of an object-literal property (assignment / shorthand / method). */
export function propertyKey(prop: Node): string | undefined {
  if (
    Node.isPropertyAssignment(prop) ||
    Node.isShorthandPropertyAssignment(prop) ||
    Node.isMethodDeclaration(prop)
  ) {
    const nameNode = prop.getNameNode()
    if (Node.isStringLiteral(nameNode)) return nameNode.getLiteralText()
    if (Node.isComputedPropertyName(nameNode)) return undefined // skip `[expr]: …`
    return nameNode.getText()
  }
  // Spread (`...knobs`) — no single key.
  return undefined
}
