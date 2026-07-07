import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path'
/**
 * overlay-tsmorph.ts — ts-morph extraction of the things the IR cannot carry:
 *   - handlerLinks: schema method → runtime handler file (follow the `execute`
 *     import in runtime/index.ts; do NOT assume a folder/name convention).
 *   - sourceSpans: file:line + JSDoc for each class/interface/edge/prop/method,
 *     keyed by anchor ref (class.X / class.X.property.y / class.X.method.m / …).
 *   - annotations: sharp-edge hints (ENUM_DROPPED_BY_UPDATE).
 *
 * Implementation notes:
 *   - We open files with a throwaway ts-morph Project (no tsconfig, no type
 *     checker required) so this stays cheap and tolerant of broken trees.
 *   - Everything degrades gracefully: a missing file/dir yields [] / {}, an
 *     unresolvable handler yields `{ unlinked: true }` rather than a wrong guess.
 */
import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph'

import type { HandlerLink, SchemaAnnotation, SchemaIR, SourceSpan } from '../../shared/types'

// ───────────────────────────── shared helpers ─────────────────────────────

/** A fresh, in-memory-ish ts-morph project: no tsconfig, tolerant of errors. */
function newProject(): Project {
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
function tryAddFile(project: Project, file: string): SourceFile | undefined {
  try {
    if (!existsSync(file)) return undefined
    return project.addSourceFileAtPath(file)
  } catch {
    return undefined
  }
}

/** Path relative to `root`, POSIX-style ('schema/monitor.ts'), never absolute. */
function relToRoot(root: string, file: string): string {
  const abs = isAbsolute(file) ? file : resolvePath(root, file)
  return relative(root, abs).split('\\').join('/')
}

/** 1-based start line of a node. */
function startLine(node: Node): number {
  return node.getStartLineNumber()
}

/**
 * Harvest the leading JSDoc / line-comment block immediately above `node`,
 * stripped of comment markers, collapsed to a single trimmed string.
 */
function leadingDoc(node: Node): string | undefined {
  // Prefer real JSDoc nodes when present (ts-morph exposes them on many decls).
  const anyNode = node as unknown as { getJsDocs?: () => Array<{ getText: () => string }> }
  if (typeof anyNode.getJsDocs === 'function') {
    const docs = anyNode.getJsDocs()
    if (docs.length > 0) {
      const text = docs.map((d) => d.getText()).join('\n')
      const cleaned = cleanComment(text)
      if (cleaned) return cleaned
    }
  }
  // Fall back to raw leading comment ranges (covers `//` line comments too).
  const ranges = node.getLeadingCommentRanges()
  if (ranges.length === 0) return undefined
  const raw = ranges.map((r) => r.getText()).join('\n')
  const cleaned = cleanComment(raw)
  return cleaned || undefined
}

/** Strip `/** *​/`, `//`, leading `*` gutters; collapse to a tidy single line. */
function cleanComment(raw: string): string {
  const lines = raw
    .replace(/\/\*\*?/g, '')
    .replace(/\*\//g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\*\s?/, '')
        .replace(/^\s*\/\/\s?/, '')
        .trim(),
    )
    .filter((l) => l.length > 0)
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

/** The call's callee identifier name, e.g. `method` / `classMethods` / `todo`. */
function calleeName(call: CallExpression): string | undefined {
  const expr = call.getExpression()
  if (Node.isIdentifier(expr)) return expr.getText()
  if (Node.isPropertyAccessExpression(expr)) return expr.getName()
  return undefined
}

/** Unwrap a string literal argument to its value. */
function stringArg(call: CallExpression, index: number): string | undefined {
  const arg = call.getArguments()[index]
  if (!arg) return undefined
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText()
  }
  return undefined
}

// ───────────────────────────── handler links ─────────────────────────────

/**
 * The shape of a "wire one method" call we recognise, after normalising the two
 * fixture styles:
 *   my-domain:   method(schema, 'Owner', 'name', { authorize, execute })
 *   evaluation:  classMethods(schema, 'Owner', { name: todo('Owner.name'), … })
 */
interface WiredMethod {
  owner: string
  method: string
  /** the object literal / call expression carrying the handler config */
  config: Node
  wiringLine: number
}

const SINGLE_METHOD_HELPERS = new Set(['method', 'remoteMethod'])
const GROUP_HELPERS = new Set([
  'classMethods',
  'interfaceMethods',
  'remoteClassMethods',
  'remoteInterfaceMethods',
])

type KernelToken = { token: string; label?: string }

/** Kernel-op idioms surfaced as `kernelCalls`; entries are longest-first. */
const KERNEL_TOKENS: KernelToken[] = [
  { token: 'graph.createEdge' },
  { token: 'graph.removeEdge' },
  { token: 'function.mutate' },
  { token: 'graph.children' },
  { token: 'function.get' },
  { token: 'graph.create' },
  { token: 'graph.update' },
  { token: 'graph.remove' },
  { token: 'graph.mutate' },
  { token: 'auth.revoke' },
  { token: 'graph.links' },
  { token: 'auth.grant' },
  { token: 'auth.check' },
  { token: 'graph.tree' },
  { token: 'graph.node' },
  { token: 'revokePerm', label: 'revokePerm (legacy)' },
  { token: 'checkPerm', label: 'checkPerm (legacy)' },
  { token: 'graph.get' },
  { token: 'grantPerm', label: 'grantPerm (legacy)' },
]

/**
 * Resolve a method-config node (object literal `{ authorize, execute }` or a
 * call like `todo('…')`) down to: the symbol that carries the real logic, plus
 * whether it is a NotImplemented stub and the authorize flavour.
 */
interface ConfigResolution {
  /** the node whose `execute` body we follow to a handler file */
  executeNode?: Node
  implemented: boolean
  /** declared auth policy; defaults to 'required' when the prop is absent. */
  auth?: 'public' | 'optional' | 'required'
  /** authorize hook shape: 'absent' | 'noop' | 'custom'. */
  authorize?: 'absent' | 'noop' | 'custom'
  authorizeSnippet?: string
  unlinkedReason?: 'no-config'
}

function resolveConfigObject(configNode: Node): ConfigResolution {
  // Case A: a call expression, e.g. `todo('Owner.name')`. Follow the helper to
  // its returned object literal (the local `todo` factory in evaluation).
  if (Node.isCallExpression(configNode)) {
    const obj = followFactoryToObject(configNode)
    if (obj) return classifyObjectLiteral(obj)
    return { implemented: false, unlinkedReason: 'no-config' }
  }
  if (Node.isObjectLiteralExpression(configNode)) {
    return classifyObjectLiteral(configNode)
  }
  // An identifier referencing a config defined elsewhere — try to resolve it.
  if (Node.isIdentifier(configNode)) {
    const decl = firstValueDeclaration(configNode)
    if (decl && Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer()
      if (init) return resolveConfigObject(init)
    }
  }
  return { implemented: false, unlinkedReason: 'no-config' }
}

/** Given `todo('x')`, find the factory's `return { … }` object literal. */
function followFactoryToObject(call: CallExpression): Node | undefined {
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return undefined
  const decl = firstValueDeclaration(expr)
  if (!decl) return undefined
  let body: Node | undefined
  if (Node.isVariableDeclaration(decl)) {
    body = decl.getInitializer()
  } else if (Node.isFunctionDeclaration(decl)) {
    body = decl
  }
  if (!body) return undefined
  // Arrow returning an object literal directly: `(name) => ({ … })`.
  if (Node.isArrowFunction(body)) {
    const arrowBody = body.getBody()
    if (Node.isParenthesizedExpression(arrowBody)) {
      const inner = arrowBody.getExpression()
      if (Node.isObjectLiteralExpression(inner)) return inner
    }
    if (Node.isObjectLiteralExpression(arrowBody)) return arrowBody
    // Block body with a `return { … }`.
    const ret = arrowBody.getFirstDescendantByKind?.(SyntaxKind.ReturnStatement)
    const retExpr = ret?.getExpression()
    if (retExpr && Node.isObjectLiteralExpression(retExpr)) return retExpr
  }
  if (Node.isFunctionDeclaration(body) || Node.isFunctionExpression(body)) {
    const ret = body.getFirstDescendantByKind(SyntaxKind.ReturnStatement)
    const retExpr = ret?.getExpression()
    if (retExpr && Node.isObjectLiteralExpression(retExpr)) return retExpr
  }
  return undefined
}

/** Inspect `{ auth, authorize, execute }` for the auth policy, authorize shape,
 *  parsed permission checks, source snippets, and execute stub-ness. */
function classifyObjectLiteral(obj: Node): ConfigResolution {
  if (!Node.isObjectLiteralExpression(obj)) {
    return { implemented: false, unlinkedReason: 'no-config' }
  }
  const executeProp = getProp(obj, 'execute')
  const authorizeProp = getProp(obj, 'authorize')

  const auth = authPolicy(obj)
  const authorize = authorizeProp ? authorizeFlavour(authorizeProp) : 'absent'
  const authorizeSnippet = authorizeProp ? snippetOf(authorizeProp) : undefined
  const common = { auth, authorize, authorizeSnippet } as const

  if (!executeProp) {
    return { implemented: false, ...common, unlinkedReason: 'no-config' }
  }
  const implemented = !isStubFunction(executeProp)
  return { executeNode: executeProp, implemented, ...common }
}

/** The declared `auth` policy on a method config; defaults to 'required'. */
function authPolicy(obj: Node): 'public' | 'optional' | 'required' {
  const v = stringLiteralOfProp(obj, 'auth')
  return v === 'public' || v === 'optional' ? v : 'required'
}

const SNIPPET_CAP = 1200

/** Source text of a node, capped for a hover preview. */
function snippetOf(node: Node): string {
  const t = node.getText()
  return t.length > SNIPPET_CAP ? `${t.slice(0, SNIPPET_CAP)}\n/* … */` : t
}

/** Get the value node of an object-literal property (handles shorthand). */
function getProp(obj: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  if (Node.isPropertyAssignment(prop)) return prop.getInitializer()
  if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode()
  if (Node.isMethodDeclaration(prop)) return prop
  return prop
}

/** 'noop' when the authorize body just returns undefined/void, else 'custom'.
 *  Follows identifier references (e.g. `authorize: allow` → `const allow = …`). */
function authorizeFlavour(node: Node): 'noop' | 'custom' {
  const fnBody = functionBodyOf(node)
  if (fnBody === undefined) return 'custom' // opaque (unresolved identifier) → assume real
  if (fnBody === null) return 'noop' // expression arrow returning `undefined`
  const text = fnBody.getText().replace(/[{}]/g, '').trim()
  // Empty block, or a single `return;` / `return undefined;`.
  if (text === '' || /^return\s*(undefined)?\s*;?$/.test(text)) return 'noop'
  return 'custom'
}

/**
 * For a function-like node return its block body (Node), or `null` if it is an
 * expression-bodied arrow whose expression is `undefined`/void, or `undefined`
 * if it is not function-like.
 */
function functionBodyOf(node: Node): Node | null | undefined {
  let fn: Node | undefined
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) fn = node
  else if (Node.isMethodDeclaration(node)) fn = node
  else if (Node.isIdentifier(node)) {
    const decl = firstValueDeclaration(node)
    if (decl && Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer()
      if (init) return functionBodyOf(init)
    }
    return undefined
  }
  if (!fn) return undefined
  const body = (fn as unknown as { getBody?: () => Node | undefined }).getBody?.()
  if (!body) return undefined
  if (Node.isBlock(body)) return body
  // Expression body: `async () => undefined`.
  if (body.getKind() === SyntaxKind.UndefinedKeyword || body.getText() === 'undefined') {
    return null
  }
  return body
}

/** A handler body that is a NotImplemented stub: only throws / `todo()`. */
function isStubFunction(node: Node): boolean {
  const body = functionBodyOf(node)
  if (!body || body === null) return false
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length === 0) return false
  // Stub iff every statement is a throw, and there is at least one throw.
  let throws = 0
  for (const st of statements) {
    if (Node.isThrowStatement(st)) {
      throws++
      continue
    }
    return false
  }
  return throws > 0
}

/** First value/declaration node a name resolves to (definition, not reference). */
function firstValueDeclaration(node: Node): Node | undefined {
  const idNode = Node.isIdentifier(node)
    ? node
    : node.getFirstDescendantByKind(SyntaxKind.Identifier)
  if (!idNode || !Node.isIdentifier(idNode)) return undefined
  const symbol = idNode.getSymbol()
  if (!symbol) return undefined
  const decls = symbol.getDeclarations()
  return decls[0]
}

/**
 * Follow an `execute` arrow → the delegated logic function it calls → that
 * function's defining file:line, chasing through barrel re-exports.
 */
function resolveExecuteTarget(executeNode: Node): { file: string; line: number } | undefined {
  // Find the call inside the execute body that targets an imported symbol.
  const body = functionBodyOf(executeNode)
  const searchRoot = body && Node.isBlock(body) ? body : executeNode
  const calls = searchRoot.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const call of calls) {
    const expr = call.getExpression()
    if (!Node.isIdentifier(expr)) continue
    const resolved = resolveImportedFunction(expr)
    if (resolved) return resolved
  }
  return undefined
}

/** Resolve an identifier (a delegated logic fn) to its defining file:line. */
function resolveImportedFunction(id: Node): { file: string; line: number } | undefined {
  if (!Node.isIdentifier(id)) return undefined
  const symbol = id.getSymbol()
  if (!symbol) return undefined
  // Walk through alias chains (import { x as y } / barrel re-export `export { x }`).
  let current = symbol
  const seen = new Set<string>()
  for (let i = 0; i < 12; i++) {
    const decls = current.getDeclarations()
    for (const decl of decls) {
      // A concrete function/variable declaration in a real file → done.
      if (Node.isFunctionDeclaration(decl)) {
        return { file: decl.getSourceFile().getFilePath(), line: decl.getStartLineNumber() }
      }
      if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer()
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          return { file: decl.getSourceFile().getFilePath(), line: decl.getStartLineNumber() }
        }
      }
    }
    // Try to hop to the aliased symbol (import specifier / export specifier).
    const aliased = trySymbolHop(current)
    if (!aliased) break
    const key = aliased
      .getDeclarations()
      .map((d) => d.getSourceFile().getFilePath() + ':' + d.getStartLineNumber())
      .join(',')
    if (seen.has(key)) break
    seen.add(key)
    current = aliased
  }
  // Last resort: resolve the module specifier of the import and grep the file.
  return resolveViaModuleSpecifier(id)
}

/** Hop one alias link via ts-morph's getAliasedSymbol, if any. */
function trySymbolHop(symbol: import('ts-morph').Symbol): import('ts-morph').Symbol | undefined {
  try {
    const aliased = symbol.getAliasedSymbol?.()
    if (aliased && aliased !== symbol) return aliased
  } catch {
    /* not an alias */
  }
  return undefined
}

/**
 * Fallback resolution: find the import declaration that brought `id` in, load
 * the target module (and barrel re-exports), and locate the exported function.
 */
function resolveViaModuleSpecifier(id: Node): { file: string; line: number } | undefined {
  if (!Node.isIdentifier(id)) return undefined
  const sourceFile = id.getSourceFile()
  const name = id.getText()
  for (const imp of sourceFile.getImportDeclarations()) {
    // Match the local binding name, capturing the original export name.
    let exportName: string | undefined
    for (const named of imp.getNamedImports()) {
      const local = named.getAliasNode()?.getText() ?? named.getName()
      if (local === name) {
        exportName = named.getName()
        break
      }
    }
    if (!exportName) continue
    const modPath = resolveModuleFile(sourceFile, imp.getModuleSpecifierValue())
    if (!modPath) continue
    const found = findExportInFile(modPath, exportName, new Set())
    if (found) return found
  }
  return undefined
}

/** Resolve a relative module specifier to a concrete .ts file path on disk. */
function resolveModuleFile(from: SourceFile, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined
  const baseDir = dirname(from.getFilePath())
  const base = resolvePath(baseDir, spec)
  const candidates = [
    base.endsWith('.ts') ? base : `${base}.ts`,
    base.endsWith('.tsx') ? base : `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

/**
 * Find where `exportName` is *defined* within `file`, following barrel
 * `export { x } from './y'` / `export * from './y'` re-exports.
 */
function findExportInFile(
  file: string,
  exportName: string,
  seen: Set<string>,
): { file: string; line: number } | undefined {
  if (seen.has(file)) return undefined
  seen.add(file)
  const project = newProject()
  const sf = tryAddFile(project, file)
  if (!sf) return undefined

  // 1) A local function declaration with that name.
  for (const fn of sf.getFunctions()) {
    if (fn.getName() === exportName && fn.isExported()) {
      return { file, line: fn.getStartLineNumber() }
    }
  }
  // 2) A local exported variable bound to a function.
  for (const v of sf.getVariableDeclarations()) {
    if (v.getName() === exportName && v.isExported()) {
      return { file, line: v.getStartLineNumber() }
    }
  }
  // 3) Re-export: `export { a, b as exportName } from './mod'`.
  for (const ex of sf.getExportDeclarations()) {
    const modSpec = ex.getModuleSpecifierValue()
    const target = modSpec ? resolveModuleFile(sf, modSpec) : undefined
    const named = ex.getNamedExports()
    if (named.length > 0) {
      for (const ne of named) {
        const exposed = ne.getAliasNode()?.getText() ?? ne.getName()
        if (exposed !== exportName) continue
        const original = ne.getName()
        if (target) {
          const found = findExportInFile(target, original, seen)
          if (found) return found
        }
      }
    } else if (target) {
      // `export * from './mod'` — search the target for the same name.
      const found = findExportInFile(target, exportName, seen)
      if (found) return found
    }
  }
  return undefined
}

/** Scan handler file text for kernel-op tokens. */
function scanKernelCalls(file: string): string[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const found: string[] = []
  let work = text
  for (const entry of KERNEL_TOKENS) {
    if (work.includes(entry.token)) {
      found.push(entry.label ?? entry.token)
      // Blank out matches so `::getLinks` doesn't also count as `::getLink`.
      work = work.split(entry.token).join(' '.repeat(entry.token.length))
    }
  }
  return found
}

/**
 * Collect every (owner, method, config) wiring from runtime/index.ts, across
 * both fixture styles, then build a HandlerLink per method.
 */
export function buildHandlerLinks(args: {
  ir: SchemaIR | null
  domainRoot: string
}): HandlerLink[] {
  const { ir, domainRoot } = args
  if (!domainRoot) return []
  const wiringRel = 'runtime/index.ts'
  const wiringAbs = resolvePath(domainRoot, wiringRel)
  const project = newProject()
  const sf = tryAddFile(project, wiringAbs)
  if (!sf) return []

  const interfaceNames = new Set(ir ? Object.keys(ir.interfaces ?? {}) : [])

  const wired: WiredMethod[] = []

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call)
    if (!name) continue

    // Style A: single-method helper — method(schema, 'Owner', 'name', { … }).
    if (SINGLE_METHOD_HELPERS.has(name)) {
      const owner = stringArg(call, 1)
      const method = stringArg(call, 2)
      const config = call.getArguments()[3]
      if (owner && method && config) {
        wired.push({ owner, method, config, wiringLine: call.getStartLineNumber() })
      }
      continue
    }

    // Style B: group helper — classMethods(schema, 'Owner', { name: cfg, … }).
    if (GROUP_HELPERS.has(name)) {
      const owner = stringArg(call, 1)
      const mapArg = call.getArguments()[2]
      if (!owner || !mapArg || !Node.isObjectLiteralExpression(mapArg)) continue
      for (const prop of mapArg.getProperties()) {
        let methodName: string | undefined
        let valueNode: Node | undefined
        if (Node.isPropertyAssignment(prop)) {
          methodName = prop.getName()
          valueNode = prop.getInitializer()
        } else if (Node.isShorthandPropertyAssignment(prop)) {
          methodName = prop.getName()
          valueNode = prop.getNameNode()
        }
        if (!methodName || !valueNode) continue
        wired.push({
          owner,
          method: methodName,
          config: valueNode,
          wiringLine: prop.getStartLineNumber(),
        })
      }
      continue
    }
  }

  // Deduplicate (owner, method): the group helper restates entries the single
  // helper already produced (e.g. my-domain wires each method, then groups them).
  // Prefer the entry whose config resolves to a real object (the single helper),
  // falling back to the group entry (which references a variable / todo()).
  const byKey = new Map<string, WiredMethod>()
  for (const w of wired) {
    const key = `${w.owner}.${w.method}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, w)
      continue
    }
    // Prefer the one whose config is an object literal (richer info).
    const existingIsObj = Node.isObjectLiteralExpression(existing.config)
    const candidateIsObj = Node.isObjectLiteralExpression(w.config)
    if (candidateIsObj && !existingIsObj) byKey.set(key, w)
  }

  const links: HandlerLink[] = []
  for (const w of byKey.values()) {
    const ownerKind: 'class' | 'interface' = interfaceNames.has(w.owner) ? 'interface' : 'class'
    const isStatic = irMethodStatic(ir, w.owner, w.method, ownerKind)

    const link: HandlerLink = {
      owner: w.owner,
      ownerKind,
      method: w.method,
      static: isStatic,
      wiringFile: wiringRel,
      wiringLine: w.wiringLine,
      implemented: true,
    }

    const resolution = resolveConfigObject(w.config)
    link.implemented = resolution.implemented
    if (resolution.auth) link.auth = resolution.auth
    if (resolution.authorize) link.authorize = resolution.authorize
    if (resolution.authorizeSnippet) link.authorizeSnippet = resolution.authorizeSnippet

    let target: { file: string; line: number } | undefined
    if (resolution.executeNode) {
      target = resolveExecuteTarget(resolution.executeNode)
    }

    if (target) {
      link.handlerFile = relToRoot(domainRoot, target.file)
      link.handlerLine = target.line
      const kernelCalls = scanKernelCalls(target.file)
      if (kernelCalls.length > 0) link.kernelCalls = kernelCalls
    } else {
      link.unlinked = true
    }

    links.push(link)
  }

  // Stable order: by owner, then method.
  links.sort((a, b) =>
    a.owner === b.owner ? a.method.localeCompare(b.method) : a.owner.localeCompare(b.owner),
  )
  return links
}

/** Look up a method's `static` flag from the IR (class or interface bucket). */
function irMethodStatic(
  ir: SchemaIR | null,
  owner: string,
  method: string,
  ownerKind: 'class' | 'interface',
): boolean {
  if (!ir) return false
  const bucket = ownerKind === 'interface' ? ir.interfaces?.[owner] : ir.classes?.[owner]
  const m = bucket?.methods?.[method]
  return m ? m.static === true : false
}

// ───────────────────────────── source spans ─────────────────────────────

const DECL_HELPERS: Record<string, 'node' | 'interface' | 'edge'> = {
  nodeClass: 'node',
  nodeInterface: 'interface',
  edgeClass: 'edge',
}

/**
 * A schema member's true NAME + section, resolved from the `defineSchema` map.
 * The declaration helpers (nodeClass/nodeInterface/edgeClass) carry no name — a
 * member is named by the KEY it is registered under, not by its variable — and a
 * domain may register a class and an interface under the SAME name (the
 * intentional same-name pattern: the `iUser` interface alongside the `User`
 * class). So the map is the sole authority for both the anchor name and the
 * interface-vs-class distinction; the variable identifier alone tells us neither.
 */
interface MemberName {
  schemaName: string
  section: 'interface' | 'class' // the `classes` map also holds edge classes
}

/** Map each registered member VARIABLE (as referenced in `defineSchema`) to its
 *  schema name + section, from the domain's own schema files — never node_modules
 *  (a dependency's `defineSchema` is not this domain's). */
function buildMemberNameMap(files: SourceFile[]): Map<string, MemberName> {
  const map = new Map<string, MemberName>()
  for (const sf of files) {
    if (sf.getFilePath().includes('/node_modules/')) continue
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (calleeName(call) !== 'defineSchema') continue
      const cfg = call.getArguments()[1]
      if (!cfg || !Node.isObjectLiteralExpression(cfg)) continue
      collectSchemaSection(map, cfg, 'interfaces', 'interface')
      collectSchemaSection(map, cfg, 'classes', 'class')
    }
  }
  return map
}

/** Record `variable → { schemaName, section }` for one `defineSchema` section
 *  (`interfaces` / `classes`), handling both `Key: alias` and shorthand `Key`. */
function collectSchemaSection(
  map: Map<string, MemberName>,
  cfg: Node,
  prop: 'interfaces' | 'classes',
  section: 'interface' | 'class',
): void {
  const obj = getObjectProp(cfg, prop)
  if (!obj) return
  for (const p of obj.getProperties()) {
    if (Node.isShorthandPropertyAssignment(p)) {
      map.set(p.getName(), { schemaName: p.getName(), section })
    } else if (Node.isPropertyAssignment(p)) {
      const init = p.getInitializer()
      if (init && Node.isIdentifier(init)) {
        map.set(init.getText(), { schemaName: p.getName(), section })
      }
    }
  }
}

/**
 * The anchor namespace ('class' | 'interface' | 'edge') for a declared member.
 * The `defineSchema` SECTION is authoritative for interface-vs-class — a
 * `nodeClass` whose name collides with a same-named interface must still anchor
 * as a class. Within the class section, an `edgeClass` (or an IR edge type)
 * anchors as 'edge'. Falls back to the declaration helper when the member isn't
 * in a parseable `defineSchema` map (e.g. an imported kernel member).
 */
function resolveMemberKind(
  ir: SchemaIR | null,
  name: string,
  section: 'interface' | 'class' | undefined,
  helperKind: 'node' | 'interface' | 'edge',
): 'class' | 'interface' | 'edge' {
  if (section === 'interface') return 'interface'
  const isEdge = helperKind === 'edge' || ir?.classes?.[name]?.type === 'edge'
  if (section === 'class') return isEdge ? 'edge' : 'class'
  if (helperKind === 'interface') return 'interface'
  return isEdge ? 'edge' : 'class'
}

export function buildSourceSpans(args: {
  ir: SchemaIR | null
  schemaDir: string
}): Record<string, SourceSpan> {
  const { ir, schemaDir } = args
  if (!schemaDir || !existsSync(schemaDir)) return {}

  // The domain root is the parent of the schema dir (spans are relative to it).
  const domainRoot = dirname(schemaDir.replace(/\/$/, ''))

  const project = newProject()
  let files: string[] = []
  try {
    const added = project.addSourceFilesAtPaths(`${schemaDir.replace(/\/$/, '')}/**/*.ts`)
    files = added.map((f) => f.getFilePath())
  } catch {
    return {}
  }

  const spans: Record<string, SourceSpan> = {}

  const sourceFiles = files.map((f) => project.getSourceFile(f)).filter((f): f is SourceFile => !!f)
  // The domain's `defineSchema` map is authoritative for each member's name +
  // interface-vs-class kind, so an aliased interface (`iUser`→`User`) and a class
  // sharing its name (`User`) each anchor correctly instead of colliding.
  const memberNames = buildMemberNameMap(sourceFiles)

  for (const sf of sourceFiles) {
    const fileRel = relToRoot(domainRoot, sf.getFilePath())

    for (const v of sf.getVariableDeclarations()) {
      if (!v.isExported()) continue
      const init = v.getInitializer()
      if (!init || !Node.isCallExpression(init)) continue
      const helper = calleeName(init)
      if (!helper || !(helper in DECL_HELPERS)) continue
      const helperKind = DECL_HELPERS[helper]
      const member = memberNames.get(v.getName())
      const name = member?.schemaName ?? v.getName()
      const ns = resolveMemberKind(ir, name, member?.section, helperKind)

      const stmt = v.getVariableStatement() ?? v
      spans[`${ns}.${name}`] = makeSpan(domainRoot, fileRel, stmt, v)

      // The single object-literal argument: nodeClass({ props, methods }) etc.
      const cfgArg = init.getArguments()[0]
      if (cfgArg && Node.isObjectLiteralExpression(cfgArg)) {
        collectPropsAndMethods(spans, ns, name, cfgArg, domainRoot, fileRel)
      }

      // Edges: endpoints are the first two args; props live in the third.
      if (ns === 'edge') {
        collectEdge(spans, name, init, domainRoot, fileRel)
      }
    }
  }

  return spans
}

/** Build a SourceSpan, harvesting leading doc from the declaration `docNode`. */
function makeSpan(domainRoot: string, fileRel: string, spanNode: Node, docNode: Node): SourceSpan {
  const span: SourceSpan = {
    file: fileRel,
    startLine: spanNode.getStartLineNumber(),
    endLine: spanNode.getEndLineNumber(),
  }
  const doc = leadingDoc(docNode) ?? leadingDoc(spanNode)
  if (doc) span.doc = doc
  return span
}

/** Record `<ns>.<Name>.property.<p>` and `.method.<m>` from a config object. */
function collectPropsAndMethods(
  spans: Record<string, SourceSpan>,
  ns: string,
  name: string,
  cfg: Node,
  domainRoot: string,
  fileRel: string,
): void {
  if (!Node.isObjectLiteralExpression(cfg)) return
  const propsObj = getObjectProp(cfg, 'props')
  if (propsObj) {
    for (const p of propsObj.getProperties()) {
      const pName = propertyKey(p)
      if (!pName) continue
      spans[`${ns}.${name}.property.${pName}`] = makeSpan(domainRoot, fileRel, p, p)
    }
  }
  const methodsObj = getObjectProp(cfg, 'methods')
  if (methodsObj) {
    for (const m of methodsObj.getProperties()) {
      const mName = propertyKey(m)
      if (!mName) continue
      spans[`${ns}.${name}.method.${mName}`] = makeSpan(domainRoot, fileRel, m, m)
    }
  }
}

/** Record edge endpoint spans `edge.<Name>.endpoint.<role>` from the two args. */
function collectEdge(
  spans: Record<string, SourceSpan>,
  name: string,
  init: CallExpression,
  domainRoot: string,
  fileRel: string,
): void {
  const argsList = init.getArguments()
  for (let i = 0; i < Math.min(2, argsList.length); i++) {
    const ep = argsList[i]
    if (!Node.isObjectLiteralExpression(ep)) continue
    const role = stringLiteralOfProp(ep, 'as')
    if (!role) continue
    spans[`edge.${name}.endpoint.${role}`] = makeSpan(domainRoot, fileRel, ep, ep)
  }
  // Edge props live in the third (config) arg's `props`.
  const cfgArg = argsList[2]
  if (cfgArg && Node.isObjectLiteralExpression(cfgArg)) {
    const propsObj = getObjectProp(cfgArg, 'props')
    if (propsObj) {
      for (const p of propsObj.getProperties()) {
        const pName = propertyKey(p)
        if (!pName) continue
        spans[`edge.${name}.property.${pName}`] = makeSpan(domainRoot, fileRel, p, p)
      }
    }
  }
}

/** The object-literal value of a named property, if it is itself an object. */
function getObjectProp(
  obj: Node,
  name: string,
): import('ts-morph').ObjectLiteralExpression | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  let value: Node | undefined
  if (Node.isPropertyAssignment(prop)) value = prop.getInitializer()
  else if (Node.isShorthandPropertyAssignment(prop)) value = prop.getNameNode()
  if (value && Node.isObjectLiteralExpression(value)) return value
  return undefined
}

/** A string-literal property value, e.g. `as: 'page'` → 'page'. */
function stringLiteralOfProp(obj: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined
  const v = prop.getInitializer()
  if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v)))
    return v.getLiteralText()
  return undefined
}

/** The key name of an object-literal property (assignment / shorthand / method). */
function propertyKey(prop: Node): string | undefined {
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

// ───────────────────────────── annotations ─────────────────────────────

export function buildSchemaAnnotations(args: { ir: SchemaIR | null }): SchemaAnnotation[] {
  const { ir } = args
  if (!ir) return []
  const out: SchemaAnnotation[] = []
  for (const cls of Object.values(ir.classes ?? {})) {
    const ns = cls.type === 'edge' ? 'edge' : 'class'
    for (const [propName, schema] of Object.entries(cls.properties ?? {})) {
      if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
        out.push({
          target: `${ns}.${cls.name}.property.${propName}`,
          severity: 'warn',
          code: 'ENUM_DROPPED_BY_UPDATE',
          message:
            'z.enum props are silently dropped by ::update — track as a plain string if it must be updated.',
        })
      }
    }
  }
  return out
}
