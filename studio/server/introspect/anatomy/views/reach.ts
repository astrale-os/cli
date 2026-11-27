/**
 * What each View's code reaches, read statically from its entry modules and never executed:
 * the Domain functions and Methods it calls, the Query and Mutation definitions it uses, and
 * the Classes their reads name. The reading follows value references from the entry modules
 * through authored modules, one module-scope declaration at a time, and returns every place it
 * cannot follow as a gap instead of guessing. It never throws: a failure is the View's data.
 */
import { join } from 'node:path'
import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type SourceFile,
  type VariableDeclaration,
} from 'ts-morph'

import type {
  DefinitionLink,
  SchemaIR,
  SourceGap,
  SourceSite,
  ViewReach,
  ViewReachRead,
} from '../../../../shared/contracts/schema'
import type { ViewEntry } from './entries'

import { definitionKind, definitionReader } from '../../source-overlay/definitions'
import { flowCache, quotedSource } from '../../source-overlay/flow'
import { declarationOf, nodeKey, relToRoot, unwrapExpression } from '../../source-overlay/project'
import {
  declarationTarget,
  moduleDeclaration,
  moduleTargets,
  readModuleGraph,
  type ModuleGraph,
  type Target,
} from './modules'

/** What the reading knows of the Domain: its IR, the overlay's definitions and its dependencies. */
export interface ReachContext {
  root: string
  schemaDirName: string
  ir: SchemaIR | null
  definitions: readonly DefinitionLink[]
  /** dependency alias → origin, as the Schema declares them */
  dependencies: Readonly<Record<string, string>>
}

const SHELL_REACT = '@astrale-os/shell-react'
/** shell-react calls whose first argument is a Domain target, and what that target is. */
const TARGET_HOOKS: ReadonlyMap<string, Kind> = new Map([
  ['useAction', 'action'],
  ['useMutation', 'mutation'],
  ['useQuery', 'query'],
  ['preload', 'query'],
  ['queryRefresh', 'query'],
])
/** shell-react calls reading a Class by its handle. */
const CLASS_HOOKS = new Set(['useObject', 'useRelation'])
/** shell-react calls reaching the Kernel or a Domain in ways this reading does not interpret. */
const UNREAD_HOOKS = new Set([
  'useCall',
  'useStream',
  'useKernel',
  'useKernelClient',
  'useDynamicDomain',
  'useDynamicObject',
])
/** How many bindings the reading follows to name what a value is. */
const MAX_EXPANSION = 16

type Kind = 'action' | 'mutation' | 'query'

/** A property path, `null` where a key is computed. */
type Segment = string | null

/** A value as a property path from where the reading stops: a parameter, or anything else. */
interface Chain {
  root: { kind: 'parameter'; fn: Node; index: number; path: readonly Segment[] } | { kind: 'other' }
  segments: readonly Segment[]
}

const OTHER: Chain = { root: { kind: 'other' }, segments: [] }

/** A hook handed one of its function's parameters: its target is what the callers pass. */
interface PassThrough {
  hook: string
  kind: Kind
  site: Node
  fn: Node
  index: number
  property?: string
}

/** What one unit (a module-scope declaration, or a module's loose statements) names itself. */
interface Scan {
  targets: Array<{ target: Target; site: Node }>
  calls: Array<{ key: string; site: Node }>
  classReads: Array<{ class: string; site: Node }>
  gaps: Array<{ node: Node; reason: string }>
  passThroughs: PassThrough[]
  /** calls and elements whose callee is a unit, keyed by the unit */
  invocations: Array<{ unit: string; site: Node }>
}

function unitKey(unit: Node): string {
  return Node.isSourceFile(unit) ? `${unit.getFilePath()}#module` : nodeKey(unit)
}

/** An identifier read as a value: not a declared name, a property name, a label or a type. */
function isValueReference(identifier: Node): boolean {
  const parent = identifier.getParent()
  if (!parent) return false
  if (Node.isShorthandPropertyAssignment(parent)) return true
  if (Node.isPropertyAccessExpression(parent)) return parent.getExpression() === identifier
  if (Node.isBindingElement(parent)) return parent.getInitializer() === identifier
  if (
    Node.isQualifiedName(parent) ||
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isLabeledStatement(parent) ||
    Node.isBreakStatement(parent) ||
    Node.isContinueStatement(parent) ||
    Node.isJsxClosingElement(parent)
  ) {
    return false
  }
  const named = parent as { getNameNode?: () => Node | undefined }
  return typeof named.getNameNode !== 'function' || named.getNameNode() !== identifier
}

/** Whether a value names a whole access chain's end, not a step inside one. */
function isChainEnd(node: Node): boolean {
  const parent = node.getParent()
  return !(
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
    parent.getExpression() === node
  )
}

function literalKey(node: Node | undefined): Segment {
  const value = node && unwrapExpression(node)
  if (value && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))) {
    return value.getLiteralValue()
  }
  if (value && Node.isNumericLiteral(value)) return value.getText()
  return null
}

/** The call or element invoking `callee`, when it is the callee or the tag. */
function invocationOf(callee: Node): Node | undefined {
  const parent = callee.getParent()
  if (Node.isCallExpression(parent) && parent.getExpression() === callee) return parent
  if (
    (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) &&
    parent.getTagNameNode() === callee
  ) {
    return parent
  }
  return undefined
}

/** The call's function, for an argument handed to it: `memo(function View() {})` is `View`'s. */
function functionUnit(fn: Node): Node | undefined {
  if (Node.isFunctionDeclaration(fn)) return moduleDeclaration(fn)
  let current = fn
  let parent = current.getParent()
  while (
    parent &&
    (Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent) ||
      (Node.isCallExpression(parent) && parent.getArguments().includes(current as never)))
  ) {
    current = parent
    parent = current.getParent()
  }
  return parent && Node.isVariableDeclaration(parent) && parent.getInitializer() === current
    ? moduleDeclaration(parent)
    : undefined
}

/** The reading of one frontend: its module graph and what each unit names. */
class FrontendReading {
  private readonly scans = new Map<string, Scan>()
  private readonly chains = new Map<string, Chain>()
  private readonly bindings = new Map<string, Set<string>>()
  private readonly shell = new Map<string, Map<string, string>>()

  constructor(
    private readonly graph: ModuleGraph,
    private readonly ir: SchemaIR | null,
  ) {}

  /** Names a module binds at module scope: what a reference to it may resolve through. */
  private moduleBindings(source: SourceFile): Set<string> {
    const file = source.getFilePath()
    let names = this.bindings.get(file)
    if (names) return names
    names = new Set()
    for (const declaration of source.getImportDeclarations()) {
      if (declaration.isTypeOnly()) continue
      const fallback = declaration.getDefaultImport()?.getText()
      if (fallback) names.add(fallback)
      const namespace = declaration.getNamespaceImport()?.getText()
      if (namespace) names.add(namespace)
      for (const specifier of declaration.getNamedImports()) {
        if (!specifier.isTypeOnly())
          names.add(specifier.getAliasNode()?.getText() ?? specifier.getName())
      }
    }
    for (const statement of source.getVariableStatements()) {
      for (const declaration of statement.getDeclarations()) {
        const name = declaration.getNameNode()
        if (Node.isIdentifier(name)) names.add(name.getText())
        else
          for (const element of name.getDescendantsOfKind(SyntaxKind.BindingElement)) {
            const bound = element.getNameNode()
            if (Node.isIdentifier(bound)) names.add(bound.getText())
          }
      }
    }
    for (const declared of [
      ...source.getFunctions(),
      ...source.getClasses(),
      ...source.getEnums(),
    ]) {
      const name = declared.getName()
      if (name) names.add(name)
    }
    this.bindings.set(file, names)
    return names
  }

  /** shell-react imports of a module: local name → exported name; `*` marks a namespace. */
  private shellImports(source: SourceFile): Map<string, string> {
    const file = source.getFilePath()
    let names = this.shell.get(file)
    if (names) return names
    names = new Map()
    for (const declaration of source.getImportDeclarations()) {
      if (declaration.isTypeOnly() || declaration.getModuleSpecifierValue() !== SHELL_REACT)
        continue
      const namespace = declaration.getNamespaceImport()?.getText()
      if (namespace) names.set(namespace, '*')
      for (const specifier of declaration.getNamedImports()) {
        names.set(specifier.getAliasNode()?.getText() ?? specifier.getName(), specifier.getName())
      }
    }
    this.shell.set(file, names)
    return names
  }

  /** The shell-react export an expression names, if it names one: `useQuery`, `Shell.useQuery`. */
  private shellName(expression: Node): string | undefined {
    const value = unwrapExpression(expression)
    const names = this.shellImports(value.getSourceFile())
    if (names.size === 0) return undefined
    if (Node.isIdentifier(value)) {
      const name = names.get(value.getText())
      if (!name || name === '*') return undefined
      const declaration = declarationOf(value)
      return declaration && Node.isImportSpecifier(declaration) ? name : undefined
    }
    if (Node.isPropertyAccessExpression(value)) {
      const base = value.getExpression()
      if (!Node.isIdentifier(base) || names.get(base.getText()) !== '*') return undefined
      const declaration = declarationOf(base)
      return declaration && Node.isNamespaceImport(declaration) ? value.getName() : undefined
    }
    return undefined
  }

  /** What a module-scope declaration or import a reference resolves to stands for. */
  private targetsOf(identifier: Node, declaration: Node): Target[] {
    if (Node.isImportSpecifier(declaration)) {
      return this.graph.imported(declaration.getImportDeclaration(), declaration.getName())
    }
    if (Node.isImportClause(declaration)) {
      const imported = declaration.getParent()
      return Node.isImportDeclaration(imported) ? this.graph.imported(imported, 'default') : []
    }
    if (Node.isNamespaceImport(declaration)) {
      const imported = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
      if (!imported) return []
      const parent = identifier.getParent()
      const name = Node.isPropertyAccessExpression(parent)
        ? parent.getName()
        : Node.isElementAccessExpression(parent)
          ? literalKey(parent.getArgumentExpression())
          : undefined
      if (typeof name === 'string') return this.graph.imported(imported, name)
      return this.graph.local(imported.getSourceFile(), identifier.getText())
    }
    const declared = moduleDeclaration(declaration)
    return declared ? [declarationTarget(declared)] : []
  }

  /** The definitions a reference names, directly or through a namespace import. */
  private definitionsOf(node: Node): CallExpression[] {
    const value = unwrapExpression(node)
    const identifier = Node.isPropertyAccessExpression(value) ? value.getExpression() : value
    if (!Node.isIdentifier(identifier)) return []
    const declaration = declarationOf(identifier)
    if (!declaration) return []
    if (identifier !== value && !Node.isNamespaceImport(declaration)) return []
    return this.targetsOf(identifier, declaration).flatMap((target) =>
      target.kind === 'definition' ? [target.call] : [],
    )
  }

  /** A value as a property path, following const bindings, destructuring and named imports. */
  private expand(node: Node, depth = 0): Chain {
    if (depth > MAX_EXPANSION) return OTHER
    const value = unwrapExpression(node)
    if (Node.isPropertyAccessExpression(value)) {
      return append(this.expand(value.getExpression(), depth + 1), [value.getName()])
    }
    if (Node.isElementAccessExpression(value)) {
      return append(this.expand(value.getExpression(), depth + 1), [
        literalKey(value.getArgumentExpression()),
      ])
    }
    if (!Node.isIdentifier(value)) return OTHER
    const declaration = declarationOf(value)
    if (!declaration) return OTHER
    const key = nodeKey(declaration)
    const held = this.chains.get(key)
    if (held) return held
    this.chains.set(key, OTHER)
    const chain = this.expandDeclaration(declaration, depth)
    this.chains.set(key, chain)
    return chain
  }

  private expandDeclaration(declaration: Node, depth: number): Chain {
    if (Node.isVariableDeclaration(declaration)) return this.expandConstant(declaration, depth)
    if (Node.isParameterDeclaration(declaration)) {
      const fn = declaration.getParent()
      const index = (fn as { getParameters?: () => Node[] }).getParameters?.().indexOf(declaration)
      return !fn || index === undefined || index < 0
        ? OTHER
        : { root: { kind: 'parameter', fn, index, path: [] }, segments: [] }
    }
    if (Node.isBindingElement(declaration)) {
      const path: Segment[] = []
      let element: Node = declaration
      for (;;) {
        const pattern = element.getParent()
        if (Node.isObjectBindingPattern(pattern) && Node.isBindingElement(element)) {
          const property = element.getPropertyNameNode()
          path.unshift(
            property
              ? Node.isComputedPropertyName(property)
                ? literalKey(property.getExpression())
                : (literalKey(property) ?? property.getText())
              : element.getName(),
          )
        } else if (Node.isArrayBindingPattern(pattern)) {
          path.unshift(String(pattern.getElements().indexOf(element as never)))
        } else return OTHER
        const owner = pattern.getParent()
        if (Node.isBindingElement(owner)) {
          element = owner
          continue
        }
        if (Node.isVariableDeclaration(owner)) {
          return append(this.expandConstant(owner, depth), path)
        }
        if (Node.isParameterDeclaration(owner)) {
          const parameter = this.expandDeclaration(owner, depth)
          return parameter.root.kind === 'parameter'
            ? { root: { ...parameter.root, path }, segments: [] }
            : OTHER
        }
        return OTHER
      }
    }
    if (Node.isImportSpecifier(declaration)) {
      const [target, ...rest] = this.graph.imported(
        declaration.getImportDeclaration(),
        declaration.getName(),
      )
      if (rest.length > 0 || target?.kind !== 'unit' || !Node.isVariableDeclaration(target.unit)) {
        return OTHER
      }
      return this.expandDeclaration(target.unit, depth + 1)
    }
    return OTHER
  }

  /** A `const`'s value as a path; any other variable may change, so the reading stops at it. */
  private expandConstant(declaration: VariableDeclaration, depth: number): Chain {
    const list = declaration.getParent()
    const initializer = declaration.getInitializer()
    return Node.isVariableDeclarationList(list) &&
      list.getDeclarationKind() === VariableDeclarationKind.Const &&
      initializer
      ? this.expand(initializer, depth + 1)
      : OTHER
  }

  /**
   * The Domain callable a path ends on: `classes.C.methods.m` or `classes.C.static.methods.m`
   * (keyed by the Class declaring `m`, `C` or one it extends), or `functions.f` (`f`); or why
   * the reading cannot name it: a computed key, a dependency's callable, or one the Schema does
   * not declare.
   */
  private callable(
    segments: readonly Segment[],
  ):
    | { key: string }
    | { computed: true }
    | { dependency: string }
    | { undeclared: string }
    | undefined {
    const n = segments.length
    const at = (index: number) => segments[index]
    let start: number | undefined
    let owner: Segment = null
    let member: Segment = null
    let kind: 'method' | 'function' | undefined
    if (n >= 5 && at(n - 5) === 'classes' && at(n - 3) === 'static' && at(n - 2) === 'methods') {
      ;[start, owner, member, kind] = [n - 5, at(n - 4) ?? null, at(n - 1) ?? null, 'method']
    } else if (n >= 4 && at(n - 4) === 'classes' && at(n - 2) === 'methods') {
      ;[start, owner, member, kind] = [n - 4, at(n - 3) ?? null, at(n - 1) ?? null, 'method']
    } else if (n >= 2 && at(n - 2) === 'functions') {
      ;[start, member, kind] = [n - 2, at(n - 1) ?? null, 'function']
    }
    if (start === undefined || !kind) return undefined
    if (start >= 2 && at(start - 2) === 'dependencies') {
      const dependency = at(start - 1)
      return dependency ? { dependency } : { computed: true }
    }
    if (member === null || (kind === 'method' && owner === null)) return { computed: true }
    if (kind === 'function') {
      return this.ir && Object.hasOwn(this.ir.functions, member)
        ? { key: member }
        : { undeclared: member }
    }
    const declaring = this.declaringClass(owner!, member)
    return declaring ? { key: `${declaring}.${member}` } : { undeclared: `${owner}.${member}` }
  }

  /** The Domain Class declaring Method `name` for Class `owner`: itself, or one it extends. */
  private declaringClass(owner: string, name: string): string | undefined {
    const seen = new Set<string>()
    const queue = [owner]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (seen.has(current)) continue
      seen.add(current)
      const declared =
        this.ir && Object.hasOwn(this.ir.classes, current) ? this.ir.classes[current] : undefined
      if (!declared) continue
      if (Object.hasOwn(declared.methods, name)) return current
      queue.push(...(declared.extends ?? []))
    }
    return undefined
  }

  /** Whether a value is a Domain target, a parameter its function's callers fill, or neither. */
  private classify(
    node: Node | undefined,
    kind: Kind,
  ): { unknown: boolean; parameters: Array<{ fn: Node; index: number; property?: string }> } {
    const known = { unknown: false, parameters: [] }
    if (!node) return known
    const value = unwrapExpression(node)
    const merge = (...nodes: Node[]) => {
      const results = nodes.map((each) => this.classify(each, kind))
      return {
        unknown: results.some((result) => result.unknown),
        parameters: results.flatMap((result) => result.parameters),
      }
    }
    if (value.getKind() === SyntaxKind.NullKeyword) return known
    if (Node.isIdentifier(value) && value.getText() === 'undefined') return known
    if (this.shellName(value) === 'skip') return known
    if (Node.isConditionalExpression(value)) return merge(value.getWhenTrue(), value.getWhenFalse())
    if (Node.isBinaryExpression(value)) {
      const operator = value.getOperatorToken().getKind()
      if (operator === SyntaxKind.AmpersandAmpersandToken) return merge(value.getRight())
      if (operator === SyntaxKind.BarBarToken || operator === SyntaxKind.QuestionQuestionToken) {
        return merge(value.getLeft(), value.getRight())
      }
    }
    if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
      return kind === 'action' ? known : { unknown: true, parameters: [] }
    }
    if (Node.isCallExpression(value) && definitionKind(value)) return known
    if (this.definitionsOf(value).length > 0) return known
    const chain = this.expand(value)
    if (this.callable(pathOf(chain))) return known
    if (chain.root.kind === 'parameter') {
      const [property, ...rest] = pathOf(chain)
      if (rest.length === 0 && property !== null) {
        return {
          unknown: false,
          parameters: [
            {
              fn: chain.root.fn,
              index: chain.root.index,
              ...(property === undefined ? {} : { property }),
            },
          ],
        }
      }
    }
    if (kind === 'action' && Node.isIdentifier(value)) {
      const declaration = declarationOf(value)
      const initializer =
        declaration && Node.isVariableDeclaration(declaration)
          ? declaration.getInitializer()
          : undefined
      if (
        (declaration && Node.isFunctionDeclaration(declaration)) ||
        (initializer &&
          (Node.isArrowFunction(unwrapExpression(initializer)) ||
            Node.isFunctionExpression(unwrapExpression(initializer))))
      ) {
        return known
      }
    }
    return { unknown: true, parameters: [] }
  }

  /** What one unit names itself, once per unit whichever View reaches it. */
  scan(unit: Node): Scan {
    const key = unitKey(unit)
    const held = this.scans.get(key)
    if (held) return held
    const scan: Scan = {
      targets: [],
      calls: [],
      classReads: [],
      gaps: [],
      passThroughs: [],
      invocations: [],
    }
    this.scans.set(key, scan)
    try {
      for (const root of scanRoots(unit)) {
        this.visit(root, scan)
        root.forEachDescendant((node, traversal) => {
          if (this.visit(node, scan) === 'skip') traversal.skip()
        })
      }
    } catch (error) {
      scan.gaps.push({
        node: unit,
        reason: `the reading cannot read this code: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    return scan
  }

  private visit(node: Node, scan: Scan): 'skip' | undefined {
    if (
      (Node.isTypeNode(node) && !Node.isExpressionWithTypeArguments(node)) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isTypeAliasDeclaration(node)
    ) {
      return 'skip'
    }
    if (Node.isCallExpression(node)) return this.visitCall(node, scan)
    if (Node.isIdentifier(node)) {
      if (isValueReference(node)) this.visitReference(node, scan)
      return undefined
    }
    if (
      (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) &&
      isChainEnd(node)
    ) {
      this.visitChain(node, scan)
    }
    return undefined
  }

  private visitCall(call: CallExpression, scan: Scan): 'skip' | undefined {
    if (definitionKind(call)) {
      scan.targets.push({ target: { kind: 'definition', call }, site: call })
      return 'skip'
    }
    const expression = call.getExpression()
    if (expression.getKind() === SyntaxKind.ImportKeyword) {
      const argument = call.getArguments()[0]
      const specifier = literalKey(argument)
      if (specifier === null) {
        scan.gaps.push({
          node: call,
          reason: `imports a module the reading cannot tell: ${quotedSource(call)}`,
        })
        return undefined
      }
      const found = this.graph.resolution(call.getSourceFile().getFilePath(), specifier)
      if (found.kind === 'module') scan.targets.push({ target: found, site: call })
      else if (found.kind === 'missing') {
        scan.gaps.push({ node: call, reason: `imports \`${specifier}\`, ${found.reason}` })
      }
      return undefined
    }
    if (expression.getText().startsWith('import.meta.glob')) {
      scan.gaps.push({
        node: call,
        reason: `imports modules by a pattern the reading does not follow: ${quotedSource(call)}`,
      })
      return undefined
    }
    const hook = this.shellName(expression)
    if (!hook) return undefined
    const argument = call.getArguments()[0]
    const kind = TARGET_HOOKS.get(hook)
    if (kind) {
      const result = this.classify(argument, kind)
      if (result.unknown) {
        scan.gaps.push({
          node: call,
          reason: `calls \`${hook}\` with a target the reading cannot tell: ${quotedSource(argument!)}`,
        })
      }
      for (const parameter of result.parameters) {
        scan.passThroughs.push({ hook, kind, site: call, ...parameter })
      }
    } else if (CLASS_HOOKS.has(hook)) {
      const segments = argument ? pathOf(this.expand(argument)) : []
      const owner = segments.at(-1)
      if (
        segments.at(-2) === 'classes' &&
        owner &&
        this.ir &&
        Object.hasOwn(this.ir.classes, owner)
      ) {
        scan.classReads.push({ class: owner, site: call })
      } else {
        scan.gaps.push({
          node: call,
          reason: `reads through \`${hook}\` a Class the reading cannot tell: ${quotedSource(argument ?? call)}`,
        })
      }
    } else if (UNREAD_HOOKS.has(hook)) {
      scan.gaps.push({
        node: call,
        reason: `uses \`${hook}\`, whose calls the reading does not interpret`,
      })
    }
    return undefined
  }

  private visitReference(identifier: Node, scan: Scan): void {
    if (isChainEnd(identifier)) this.visitChain(identifier, scan)
    if (!this.moduleBindings(identifier.getSourceFile()).has(identifier.getText())) return
    const declaration = declarationOf(identifier)
    if (!declaration) return
    const parent = identifier.getParent()
    // `f()`, `<F />`, and through a namespace import `ns.f()`, `<ns.F />`
    const invocation =
      invocationOf(identifier) ??
      (Node.isNamespaceImport(declaration) && Node.isPropertyAccessExpression(parent)
        ? invocationOf(parent)
        : undefined)
    for (const target of this.targetsOf(identifier, declaration)) {
      if (target.kind === 'opaque') continue
      if (target.kind === 'module' && Node.isNamespaceImport(declaration)) {
        scan.gaps.push({
          node: identifier,
          reason: `uses the namespace \`${identifier.getText()}\` whole: the reading counts everything its module declares as reached`,
        })
      }
      scan.targets.push({ target, site: identifier })
      if (invocation && target.kind === 'unit') {
        scan.invocations.push({ unit: unitKey(target.unit), site: invocation })
      }
    }
  }

  private visitChain(node: Node, scan: Scan): void {
    const found = this.callable(pathOf(this.expand(node)))
    if (!found) return
    if ('key' in found) scan.calls.push({ key: found.key, site: node })
    else if ('undeclared' in found) {
      scan.gaps.push({
        node,
        reason: `names \`${found.undeclared}\`, which the Domain’s Schema does not declare: ${quotedSource(node)}`,
      })
    } else if ('dependency' in found) {
      scan.gaps.push({
        node,
        reason: `names a callable of the dependency \`${found.dependency}\`, which the reading does not attribute: ${quotedSource(node)}`,
      })
    } else {
      scan.gaps.push({
        node,
        reason: `names a callable through a key the reading cannot tell: ${quotedSource(node)}`,
      })
    }
  }

  /**
   * Where a pass-through's target comes from: each reached caller's argument, followed through
   * further pass-throughs. A caller passing what the reading cannot tell, or no reached caller
   * at all, is a gap.
   */
  settle(
    passThrough: PassThrough,
    invocations: ReadonlyMap<string, readonly Node[]>,
  ): Array<{ node: Node; reason: string }> {
    const gaps: Array<{ node: Node; reason: string }> = []
    const seen = new Set<string>()
    const queue = [passThrough as Omit<PassThrough, 'hook' | 'kind' | 'site'>]
    while (queue.length > 0) {
      const { fn, index, property } = queue.shift()!
      const key = `${nodeKey(fn)}:${index}:${property ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const unit = functionUnit(fn)
      const callers = unit ? (invocations.get(unitKey(unit)) ?? []) : []
      if (callers.length === 0) {
        gaps.push({
          node: passThrough.site,
          reason: `calls \`${passThrough.hook}\` with a parameter whose callers the reading cannot find: ${quotedSource(passThrough.site.getChildAtIndex(2) ?? passThrough.site)}`,
        })
        continue
      }
      for (const caller of callers) {
        const argument = argumentAt(caller, index, property)
        if (argument === 'unknown') {
          gaps.push({
            node: caller,
            reason: `hands \`${passThrough.hook}\` a target the reading cannot tell: ${quotedSource(caller)}`,
          })
          continue
        }
        const result = this.classify(argument, passThrough.kind)
        if (result.unknown) {
          gaps.push({
            node: caller,
            reason: `hands \`${passThrough.hook}\` a target the reading cannot tell: ${quotedSource(argument!)}`,
          })
        }
        queue.push(...result.parameters)
      }
    }
    return gaps
  }
}

/** A value's whole property path, from the parameter it starts from when it does. */
function pathOf(chain: Chain): readonly Segment[] {
  return chain.root.kind === 'parameter' ? [...chain.root.path, ...chain.segments] : chain.segments
}

function append(chain: Chain, segments: readonly Segment[]): Chain {
  return chain.root.kind === 'other' && chain.segments.length === 0 && segments.length === 0
    ? chain
    : { root: chain.root, segments: [...chain.segments, ...segments] }
}

/** The nodes a unit runs: a declaration's value, or a module's loose statements. */
function scanRoots(unit: Node): Node[] {
  if (Node.isSourceFile(unit)) {
    return unit
      .getStatements()
      .filter(
        (statement) =>
          !Node.isImportDeclaration(statement) &&
          !Node.isExportDeclaration(statement) &&
          !Node.isVariableStatement(statement) &&
          !Node.isFunctionDeclaration(statement) &&
          !Node.isClassDeclaration(statement) &&
          !Node.isInterfaceDeclaration(statement) &&
          !Node.isTypeAliasDeclaration(statement) &&
          !Node.isEnumDeclaration(statement) &&
          !Node.isModuleDeclaration(statement) &&
          !Node.isExportAssignment(statement),
      )
  }
  if (Node.isVariableDeclaration(unit)) {
    const initializer = unit.getInitializer()
    return initializer ? [initializer] : []
  }
  return [unit]
}

/**
 * What a call or element passes as a function's parameter: the argument at `index`, or the
 * `property` of the object it passes there (an element's attribute); undefined when it passes
 * nothing, 'unknown' when the reading cannot tell (a spread, a non-literal object).
 */
function argumentAt(
  caller: Node,
  index: number,
  property: string | undefined,
): Node | undefined | 'unknown' {
  if (Node.isCallExpression(caller)) {
    const args = caller.getArguments()
    if (args.slice(0, index + 1).some((arg) => Node.isSpreadElement(arg))) return 'unknown'
    const argument = args[index]
    if (property === undefined || !argument) return argument
    const object = unwrapExpression(argument)
    if (!Node.isObjectLiteralExpression(object)) return 'unknown'
    const assigned = object.getProperty(property)
    if (assigned && Node.isPropertyAssignment(assigned)) return assigned.getInitializer()
    if (assigned && Node.isShorthandPropertyAssignment(assigned)) return assigned.getNameNode()
    return object.getProperties().some((each) => Node.isSpreadAssignment(each))
      ? 'unknown'
      : undefined
  }
  if (Node.isJsxOpeningElement(caller) || Node.isJsxSelfClosingElement(caller)) {
    if (index !== 0 || property === undefined) return 'unknown'
    let spread = false
    for (const attribute of caller.getAttributes()) {
      if (Node.isJsxSpreadAttribute(attribute)) {
        spread = true
        continue
      }
      if (attribute.getNameNode().getText() !== property) continue
      const initializer = attribute.getInitializer()
      if (!initializer) return 'unknown'
      return Node.isJsxExpression(initializer) ? initializer.getExpression() : initializer
    }
    return spread ? 'unknown' : undefined
  }
  return 'unknown'
}

interface Collected {
  modules: Set<string>
  calls: Array<{ key: string; site: Node }>
  definitions: Array<{ call: CallExpression; site: Node }>
  classReads: Array<{ class: string; site: Node }>
  gaps: Array<{ node: Node; reason: string }>
}

/** Every unit the entries reach, and what they name: module bodies run on load, the rest on use. */
function collect(
  reading: FrontendReading,
  graph: ModuleGraph,
  entries: readonly string[],
): Collected {
  const collected: Collected = {
    modules: new Set(),
    calls: [],
    definitions: [],
    classReads: [],
    gaps: [],
  }
  const units = new Map<string, Node>()
  const queue: Node[] = []
  const reach = (unit: Node) => {
    const key = unitKey(unit)
    if (units.has(key)) return
    units.set(key, unit)
    queue.push(unit)
  }
  const load = (file: string) => {
    const pending = [file]
    while (pending.length > 0) {
      const next = pending.pop()!
      if (collected.modules.has(next)) continue
      const source = graph.modules.get(next)
      if (!source) continue
      collected.modules.add(next)
      reach(source)
      for (const declaration of source.getImportDeclarations()) {
        if (declaration.isTypeOnly()) continue
        const specifier = declaration.getModuleSpecifierValue()
        const found = graph.resolution(next, specifier)
        if (found.kind === 'missing') {
          collected.gaps.push({
            node: declaration,
            reason: `imports \`${specifier}\`, ${found.reason}`,
          })
        }
      }
      for (const declaration of source.getExportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue()
        if (specifier === undefined || declaration.isTypeOnly()) continue
        const found = graph.resolution(next, specifier)
        if (found.kind === 'missing') {
          collected.gaps.push({
            node: declaration,
            reason: `re-exports \`${specifier}\`, ${found.reason}`,
          })
        }
      }
      pending.push(...(graph.staticImports.get(next) ?? []))
    }
  }
  const whole = new Set<string>()
  const follow = (target: Target, site: Node) => {
    if (target.kind === 'unit') reach(target.unit)
    else if (target.kind === 'definition') collected.definitions.push({ call: target.call, site })
    else if (target.kind === 'module' && !whole.has(target.file)) {
      whole.add(target.file)
      load(target.file)
      for (const member of moduleTargets(graph, target.file)) follow(member, site)
    }
  }

  for (const entry of entries) load(entry)
  const passThroughs: PassThrough[] = []
  const invocations = new Map<string, Node[]>()
  while (queue.length > 0) {
    const scan = reading.scan(queue.shift()!)
    collected.calls.push(...scan.calls)
    collected.classReads.push(...scan.classReads)
    collected.gaps.push(...scan.gaps)
    passThroughs.push(...scan.passThroughs)
    for (const { unit, site } of scan.invocations) {
      invocations.set(unit, [...(invocations.get(unit) ?? []), site])
    }
    for (const { target, site } of scan.targets) follow(target, site)
  }
  for (const passThrough of passThroughs) {
    collected.gaps.push(...reading.settle(passThrough, invocations))
  }
  return collected
}

function bySite(left: SourceSite, right: SourceSite): number {
  return left.file.localeCompare(right.file) || left.line - right.line
}

function uniqueSites(sites: readonly SourceSite[]): SourceSite[] {
  const held = new Map(sites.map((site) => [`${site.file}:${site.line}`, site]))
  return [...held.values()].sort(bySite)
}

/**
 * Read what each View's code reaches. Views starting from the same entry modules are read once,
 * and their reading says that it is their shared frontend's.
 */
export function readViewReach(
  context: ReachContext,
  entries: ReadonlyMap<string, ViewEntry>,
): Map<string, ViewReach> {
  const reaches = new Map<string, ViewReach>()
  const groups = new Map<
    string,
    { slugs: string[]; entry: Extract<ViewEntry, { kind: 'modules' }> }
  >()
  for (const [slug, entry] of entries) {
    if (entry.kind !== 'modules') {
      reaches.set(
        slug,
        entry.kind === 'none'
          ? { status: 'none', reason: entry.reason }
          : { status: 'unread', ...withoutKind(entry) },
      )
      continue
    }
    const key = `${entry.build.key}\0${[...entry.modules].sort().join('\0')}`
    const group = groups.get(key)
    if (group) group.slugs.push(slug)
    else groups.set(key, { slugs: [slug], entry })
  }
  if (groups.size === 0) return reaches

  try {
    const site = (node: Node): SourceSite => ({
      file: relToRoot(context.root, node.getSourceFile().getFilePath()),
      line: node.getStartLineNumber(),
    })
    const overlay = new Map(context.definitions.map((link) => [`${link.file}:${link.line}`, link]))
    const read = definitionReader({
      domainRoot: context.root,
      ir: context.ir,
      dependencies: context.dependencies,
      cache: flowCache(),
    })
    const own = new Map<string, DefinitionLink | null>()
    const identify = (call: CallExpression): { link: DefinitionLink; own: boolean } | undefined => {
      const link = overlay.get(`${site(call).file}:${site(call).line}`)
      if (link) return { link, own: false }
      const key = nodeKey(call)
      if (!own.has(key)) own.set(key, read(call) ?? null)
      const read_ = own.get(key)
      return read_ ? { link: read_, own: true } : undefined
    }

    const readings = new Map<string, { graph: ModuleGraph; reading: FrontendReading }>()
    const schemaDir = join(context.root, context.schemaDirName)
    for (const { entry } of groups.values()) {
      if (readings.has(entry.build.key)) continue
      const modules = [...groups.values()]
        .filter((group) => group.entry.build.key === entry.build.key)
        .flatMap((group) => group.entry.modules)
      const graph = readModuleGraph([...new Set(modules)], {
        domainRoot: context.root,
        schemaDir,
        build: entry.build,
      })
      readings.set(entry.build.key, { graph, reading: new FrontendReading(graph, context.ir) })
    }

    for (const { slugs, entry } of groups.values()) {
      const { graph, reading } = readings.get(entry.build.key)!
      const collected = collect(reading, graph, entry.modules)
      const gaps = new Map<string, SourceGap>()
      const gap = (value: SourceGap) =>
        gaps.set(`${value.file}:${value.line}:${value.reason}`, value)
      for (const each of entry.build.gaps) gap(each)
      for (const { node, reason } of collected.gaps) gap({ ...site(node), reason })
      for (const module of entry.modules) {
        if (!graph.modules.has(module)) {
          gap({
            file: relToRoot(context.root, module),
            line: 1,
            reason: 'is an entry module the reading cannot read',
          })
        }
      }

      const calls = new Map<string, SourceSite[]>()
      for (const { key, site: at } of collected.calls)
        calls.set(key, [...(calls.get(key) ?? []), site(at)])
      const definitions = new Map<string, { link: DefinitionLink; sites: SourceSite[] }>()
      const ownDefinitions = new Map<string, DefinitionLink>()
      for (const { call, site: at } of collected.definitions) {
        const found = identify(call)
        if (!found) {
          gap({
            ...site(call),
            reason: `declares a definition whose id the reading cannot tell: ${quotedSource(call)}`,
          })
          continue
        }
        const key = `${found.link.kind}:${found.link.id}`
        const held = definitions.get(key)
        definitions.set(key, { link: found.link, sites: [...(held?.sites ?? []), site(at)] })
        if (found.own) ownDefinitions.set(key, found.link)
      }
      const reads = new Map<string, { definitions: Set<string>; sites: SourceSite[] }>()
      const readOf = (name: string) => {
        let held = reads.get(name)
        if (!held) {
          held = { definitions: new Set(), sites: [] }
          reads.set(name, held)
        }
        return held
      }
      for (const { link } of definitions.values()) {
        for (const effect of link.effects ?? []) {
          if (effect.kind === 'read') readOf(effect.class).definitions.add(link.id)
        }
      }
      for (const { class: name, site: at } of collected.classReads)
        readOf(name).sites.push(site(at))

      const shared = slugs.length > 1
      for (const slug of slugs) {
        const result: ViewReachRead = {
          status: 'read',
          scope: shared ? 'frontend' : 'view',
          sharedWith: slugs.filter((other) => other !== slug),
          entries: entry.modules.map((module) => relToRoot(context.root, module)),
          ...(entry.inferred ? { inferred: entry.inferred } : {}),
          files: collected.modules.size,
          calls: [...calls]
            .map(([key, sites]) => ({ key, sites: uniqueSites(sites) }))
            .sort((left, right) => left.key.localeCompare(right.key)),
          definitions: [...definitions.values()]
            .map(({ link, sites }) => ({ kind: link.kind, id: link.id, sites: uniqueSites(sites) }))
            .sort(
              (left, right) =>
                left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind),
            ),
          reads: [...reads]
            .map(([name, held]) => ({
              class: name,
              definitions: [...held.definitions].sort(),
              sites: uniqueSites(held.sites),
            }))
            .sort((left, right) => left.class.localeCompare(right.class)),
          ownDefinitions: [...ownDefinitions.values()].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
          gaps: [...gaps.values()].sort(
            (left, right) => bySite(left, right) || left.reason.localeCompare(right.reason),
          ),
        }
        reaches.set(slug, result)
      }
    }
  } catch (error) {
    const reason = `The reading failed: ${error instanceof Error ? error.message : String(error)}`
    for (const { slugs } of groups.values()) {
      for (const slug of slugs) reaches.set(slug, { status: 'unread', reason })
    }
  }
  return reaches
}

function withoutKind(entry: Extract<ViewEntry, { kind: 'unread' }>): {
  reason: string
  file?: string
  line?: number
} {
  return {
    reason: entry.reason,
    ...(entry.file === undefined ? {} : { file: entry.file }),
    ...(entry.line === undefined ? {} : { line: entry.line }),
  }
}
