/**
 * Handler wiring overlay for canonical implementation maps and legacy runtime helpers.
 */
import { resolve as resolvePath } from 'node:path'
import { Node, SyntaxKind, type CallExpression } from 'ts-morph'

import type { HandlerLink, SchemaIR } from '../../../shared/types'

import { scanKernelCalls } from './kernel-calls'
import {
  calleeName,
  firstValueDeclaration,
  getProp,
  newProject,
  objectPropertyValue,
  propertyKey,
  relToRoot,
  resolveModuleFile,
  resolveObjectLiteral,
  stringLiteralOfProp,
  tryAddFile,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

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

/** Recognized method-wiring calls after normalizing single-method and grouped helpers. */
interface WiredMethod {
  owner: string
  method: string
  /** the object literal / call expression carrying the handler config */
  config: Node
  wiringLine: number
  wiringFile: string
  ownerKind?: 'class' | 'interface' | 'function'
  style?: 'legacy-config' | 'direct-handler'
}

const SINGLE_METHOD_HELPERS = new Set(['method', 'remoteMethod'])
const GROUP_HELPERS = new Set([
  'classMethods',
  'interfaceMethods',
  'remoteClassMethods',
  'remoteInterfaceMethods',
])

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

function resolveConfigObject(configNode: Node, seen = new Set<string>()): ConfigResolution {
  const node = unwrapExpression(configNode)
  const key = `${node.getSourceFile().getFilePath()}:${node.getStart()}`
  if (seen.has(key)) return { implemented: false, unlinkedReason: 'no-config' }
  seen.add(key)

  if (Node.isCallExpression(node)) {
    // Curried SDK helpers carry the handler config in their final argument:
    // `remoteMethod()(schema, 'Issue', 'delete', { authorize, execute })`.
    const lastArg = node.getArguments().at(-1)
    if (lastArg) {
      const candidate = unwrapExpression(lastArg)
      if (Node.isObjectLiteralExpression(candidate) || Node.isIdentifier(candidate)) {
        return resolveConfigObject(candidate, seen)
      }
    }

    // Local factories such as `todo('Owner.name')` return the config object themselves.
    const obj = followFactoryToObject(node)
    if (obj) return classifyObjectLiteral(obj)
    return { implemented: false, unlinkedReason: 'no-config' }
  }
  if (Node.isObjectLiteralExpression(node)) {
    return classifyObjectLiteral(node)
  }
  // Handler maps normally reference a local or imported `remoteMethod` value.
  if (Node.isIdentifier(node)) {
    const value = valueOfIdentifier(node)
    if (value) return resolveConfigObject(value, seen)
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
    const value = valueOfIdentifier(node)
    if (value) return functionBodyOf(value)
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
  const project = newProject()
  const legacyWiringRel = 'runtime/index.ts'
  const legacySf = tryAddFile(project, resolvePath(domainRoot, legacyWiringRel))

  const interfaceNames = new Set(ir ? Object.keys(ir.interfaces ?? {}) : [])

  const wired: WiredMethod[] = []

  if (legacySf) {
    for (const call of legacySf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = calleeName(call)
      if (!name) continue

      // Style A: single-method helper — method(schema, 'Owner', 'name', { … }).
      if (SINGLE_METHOD_HELPERS.has(name)) {
        const owner = stringArg(call, 1)
        const method = stringArg(call, 2)
        const config = call.getArguments()[3]
        if (owner && method && config) {
          wired.push({
            owner,
            method,
            config,
            wiringLine: call.getStartLineNumber(),
            wiringFile: legacyWiringRel,
            style: 'legacy-config',
          })
        }
        continue
      }

      // Style B: group helper — classMethods(schema, 'Owner', { name: cfg, … }).
      if (GROUP_HELPERS.has(name)) {
        const owner = stringArg(call, 1)
        const mapArg = call.getArguments()[2]
        if (!owner || !mapArg || !Node.isObjectLiteralExpression(mapArg)) continue
        for (const prop of mapArg.getProperties()) {
          const valueNode = objectPropertyValue(prop)
          const methodName = propertyKey(prop)
          if (!methodName || !valueNode) continue
          wired.push({
            owner,
            method: methodName,
            config: valueNode,
            wiringLine: prop.getStartLineNumber(),
            wiringFile: legacyWiringRel,
            style: 'legacy-config',
          })
        }
        continue
      }
    }
  }

  // Current SDK layout: `implementation.ts` owns a plain
  // `handlers: { classes, interfaces, functions }` object passed to
  // `defineDomain` / `defineDomain.public`. Start from that call so inline
  // handler maps and arbitrarily named handler variables are both visible.
  // Class/interface entries point directly at handler functions; there is no
  // legacy `{ authorize, execute }` wrapper.
  for (const wiringRel of ['implementation.ts', 'domain.ts']) {
    const sf = tryAddFile(project, resolvePath(domainRoot, wiringRel))
    if (!sf) continue

    const handlerObjects: import('ts-morph').ObjectLiteralExpression[] = []
    const seenHandlerObjects = new Set<string>()
    const addHandlerObject = (candidate: Node | undefined) => {
      const handlersObject = candidate ? resolveObjectLiteral(candidate) : undefined
      if (!handlersObject) return
      const key = `${handlersObject.getSourceFile().getFilePath()}:${handlersObject.getStart()}`
      if (seenHandlerObjects.has(key)) return
      seenHandlerObjects.add(key)
      handlerObjects.push(handlersObject)
    }

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isDefineDomainCall(call)) continue
      const input = call.getArguments()[0]
      const inputObject = input ? resolveObjectLiteral(input) : undefined
      addHandlerObject(inputObject ? getProp(inputObject, 'handlers') : undefined)
    }

    // Tolerate pre-composition fixtures that expose a conventional `handlers`
    // variable without a parseable defineDomain call.
    const handlersDecl = sf.getVariableDeclaration('handlers')
    addHandlerObject(handlersDecl?.getInitializer())

    for (const handlersObject of handlerObjects) {
      const handlersFile = relToRoot(domainRoot, handlersObject.getSourceFile().getFilePath())
      collectDirectHandlerSection(wired, handlersObject, 'classes', 'class', handlersFile)
      collectDirectHandlerSection(wired, handlersObject, 'interfaces', 'interface', handlersFile)
      collectDirectFunctionHandlers(wired, handlersObject, ir?.domain ?? 'domain', handlersFile)
    }
  }

  // Deduplicate (owner, method): the group helper restates entries the single
  // helper already produced (e.g. my-domain wires each method, then groups them).
  // Prefer the entry whose config resolves to a real object (the single helper),
  // falling back to the group entry (which references a variable / todo()).
  const byKey = new Map<string, WiredMethod>()
  for (const w of wired) {
    const key = `${w.ownerKind ?? 'legacy'}:${w.owner}.${w.method}`
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
    const ownerKind: 'class' | 'interface' | 'function' =
      w.ownerKind ?? (interfaceNames.has(w.owner) ? 'interface' : 'class')
    const isStatic = irMethodStatic(ir, w.owner, w.method, ownerKind)

    const link: HandlerLink = {
      owner: w.owner,
      ownerKind,
      method: w.method,
      static: isStatic,
      wiringFile: w.wiringFile,
      wiringLine: w.wiringLine,
      implemented: true,
    }

    let target: { file: string; line: number } | undefined
    if (w.style === 'direct-handler') {
      const direct = resolveDirectHandler(w.config)
      link.implemented = direct.implemented
      target = direct.target
      applyCanonicalMethodAuth(link, ir, w.owner, w.method, ownerKind)
    } else {
      const resolution = resolveConfigObject(w.config)
      link.implemented = resolution.implemented
      if (resolution.auth) link.auth = resolution.auth
      if (resolution.authorize) link.authorize = resolution.authorize
      if (resolution.authorizeSnippet) link.authorizeSnippet = resolution.authorizeSnippet
      if (resolution.executeNode) target = resolveExecuteTarget(resolution.executeNode)
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

/** Whether a call is the current SDK composition entrypoint. */
function isDefineDomainCall(call: CallExpression): boolean {
  const expression = unwrapExpression(call.getExpression())
  if (Node.isIdentifier(expression)) return expression.getText() === 'defineDomain'
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'public') {
    return false
  }
  const receiver = unwrapExpression(expression.getExpression())
  return Node.isIdentifier(receiver) && receiver.getText() === 'defineDomain'
}

/** Collect current `handlers.classes/interfaces.Owner.method = fn` bindings. */
function collectDirectHandlerSection(
  out: WiredMethod[],
  handlers: import('ts-morph').ObjectLiteralExpression,
  section: 'classes' | 'interfaces',
  ownerKind: 'class' | 'interface',
  wiringFile: string,
): void {
  const sectionValue = getProp(handlers, section)
  const sectionObject = sectionValue ? resolveObjectLiteral(sectionValue) : undefined
  if (!sectionObject) return
  for (const ownerProp of sectionObject.getProperties()) {
    const owner = propertyKey(ownerProp)
    const ownerValue = objectPropertyValue(ownerProp)
    const ownerObject = ownerValue ? resolveObjectLiteral(ownerValue) : undefined
    if (!owner || !ownerObject) continue
    for (const methodProp of ownerObject.getProperties()) {
      const method = propertyKey(methodProp)
      const handler = objectPropertyValue(methodProp)
      if (!method || !handler) continue
      out.push({
        owner,
        ownerKind,
        method,
        config: handler,
        wiringLine: methodProp.getStartLineNumber(),
        wiringFile,
        style: 'direct-handler',
      })
    }
  }
}

/** Collect current standalone `handlers.functions.name = fn` bindings. */
function collectDirectFunctionHandlers(
  out: WiredMethod[],
  handlers: import('ts-morph').ObjectLiteralExpression,
  owner: string,
  wiringFile: string,
): void {
  const functionsValue = getProp(handlers, 'functions')
  const functions = functionsValue ? resolveObjectLiteral(functionsValue) : undefined
  if (!functions) return
  for (const functionProp of functions.getProperties()) {
    const method = propertyKey(functionProp)
    const handler = objectPropertyValue(functionProp)
    if (!method || !handler) continue
    out.push({
      owner,
      ownerKind: 'function',
      method,
      config: handler,
      wiringLine: functionProp.getStartLineNumber(),
      wiringFile,
      style: 'direct-handler',
    })
  }
}

/** Follow a direct SDK handler to its defining source node. */
function resolveDirectHandler(config: Node): {
  implemented: boolean
  target?: { file: string; line: number }
} {
  let value = unwrapExpression(config)
  if (Node.isIdentifier(value)) value = valueOfIdentifier(value) ?? value
  value = unwrapExpression(value)
  const concrete =
    Node.isArrowFunction(value) ||
    Node.isFunctionExpression(value) ||
    Node.isFunctionDeclaration(value) ||
    Node.isMethodDeclaration(value) ||
    Node.isCallExpression(value)
  if (!concrete) return { implemented: false }
  return {
    implemented: Node.isCallExpression(value) ? true : !isStubFunction(value),
    target: { file: value.getSourceFile().getFilePath(), line: value.getStartLineNumber() },
  }
}

/** Map the canonical callable auth declaration onto the existing Studio badge model. */
function applyCanonicalMethodAuth(
  link: HandlerLink,
  ir: SchemaIR | null,
  owner: string,
  method: string,
  ownerKind: 'class' | 'interface' | 'function',
): void {
  const callable =
    ownerKind === 'function'
      ? ir?.functions?.[method]
      : ownerKind === 'interface'
        ? ir?.interfaces?.[owner]?.methods?.[method]
        : ir?.classes?.[owner]?.methods?.[method]
  const auth = callable?.auth
  if (auth) link.callableAuth = auth
  if (auth === 'anonymous') {
    link.auth = 'public'
    link.authorize = 'absent'
  } else if (auth === 'authorized') {
    link.auth = 'required'
    link.authorize = 'custom'
  } else if (auth === 'authenticated') {
    link.auth = 'required'
    link.authorize = 'absent'
  }
}

/** Look up a method's `static` flag from the IR (class or interface bucket). */
function irMethodStatic(
  ir: SchemaIR | null,
  owner: string,
  method: string,
  ownerKind: 'class' | 'interface' | 'function',
): boolean {
  if (!ir) return false
  if (ownerKind === 'function') return true
  const bucket = ownerKind === 'interface' ? ir.interfaces?.[owner] : ir.classes?.[owner]
  const m = bucket?.methods?.[method]
  return m ? m.static === true : false
}
