/**
 * A bounded reading of where values go in authored code. Nothing in the SDK declares
 * which helper receives a builder, a set of clients or a Class handle: this reading
 * follows each value through renaming, destructuring, object literals, the helpers it
 * is handed to and back out of what they return, and into the functions written
 * around it, each reading the names it closes over where it was written.
 *
 * What the values are, and what using one means, belongs to a language. The reading
 * names every place where a value the language holds leaves what it can follow,
 * instead of guessing.
 */
import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type PropertyAccessExpression,
} from 'ts-morph'

import type { SourceGap } from '../../../shared/contracts/schema'

import {
  declarationOf,
  isFunction,
  nodeKey,
  propertyKey,
  relToRoot,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

export type Callable = FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration

export function isCallable(node: Node): node is Callable {
  return isFunction(node) || Node.isMethodDeclaration(node)
}

/** A value a language gives meaning to; `function` and `object` are the reading's own kinds. */
export interface FlowValue {
  readonly kind: string
}

/**
 * An authored function as a value, with the reading it is written in: a helper may call
 * back what it was handed, and the function reads the names it closes over where it
 * was written.
 */
export interface FunctionFlow<V extends FlowValue> {
  readonly kind: 'function'
  readonly node: Callable
  /** undefined for a function written at module scope */
  readonly closure: Scope<V> | undefined
}

/** An object carrying values under named properties, as a handler's context does. */
export interface ObjectFlow<V extends FlowValue> {
  readonly kind: 'object'
  readonly properties: ReadonlyMap<string, Flow<V>>
}

export type Flow<V extends FlowValue> = V | FunctionFlow<V> | ObjectFlow<V>

export function isFunctionFlow<V extends FlowValue>(flow: Flow<V>): flow is FunctionFlow<V> {
  return flow.kind === 'function'
}

export function isObjectFlow<V extends FlowValue>(flow: Flow<V>): flow is ObjectFlow<V> {
  return flow.kind === 'object'
}

function isValue<V extends FlowValue>(flow: Flow<V>): flow is V {
  return flow.kind !== 'function' && flow.kind !== 'object'
}

/** One reading of one function: the bindings it holds, keyed by declaration (`nodeKey`). */
export interface Scope<V extends FlowValue> {
  /** the function read; what it returns, the call that handed its flows reads */
  readonly fn: Callable
  /** the reading of the function it is written in, for the names it closes over */
  readonly closure: Scope<V> | undefined
  /** tells two readings of one function apart, as the functions each writes */
  readonly id: number
  /** calls from the first reading */
  readonly depth: number
  readonly flows: Map<string, Flow<V>>
  /** their names, to skip every other identifier cheaply */
  readonly names: Set<string>
}

/** What a language's hooks may do in the reading that meets the value. */
export interface Reading<V extends FlowValue> {
  readonly scope: Scope<V>
  evaluate(node: Node): Flow<V> | undefined
  bind(name: Node, flow: Flow<V>): void
  /**
   * Read `fn` handed `flows`, as the call at `site` does: what it returns. A function the
   * language reads this way is not read again where it is written.
   */
  visit(
    fn: FunctionFlow<V>,
    flows: ReadonlyArray<Flow<V> | undefined>,
    site: Node,
  ): Flow<V> | undefined
  gap(node: Node, reason: string): void
}

/** What the values a reading follows mean. */
export interface FlowLanguage<V extends FlowValue> {
  /** What reading the member `name` of a value gives; may record what the access means. */
  member(value: V, name: string, at: Node, reading: Reading<V>): Flow<V> | undefined
  /** What calling a value gives; called once or more per call, so it records idempotently. */
  call?(value: V, expression: CallExpression, reading: Reading<V>): Flow<V> | undefined
  /** A value the reading does not evaluate itself: a literal, an array, a name no reading binds. */
  evaluate?(node: Node, reading: Reading<V>): Flow<V> | undefined
  /** The member names a value stands for, when it is used as a computed name. */
  names?(value: V): readonly string[] | undefined
  /** Which branch a condition takes, when the language can tell. */
  decide?(condition: Node, reading: Reading<V>): boolean | undefined
  /**
   * One value for what either of two branches gives; `right` is undefined when its branch
   * gives nothing the reading can tell, so what stands of `left` alone is what holds in
   * every branch. `left` when absent.
   */
  either?(left: V, right: V | undefined): V | undefined
  /** Whether a value carries what the reading is for: losing it is a gap. */
  holds(value: V): boolean
  /** Whether a helper handed the value is worth reading; `holds` when absent. */
  follows?(value: V): boolean
  describe(flow: Flow<V>): string
  /** The value's identity in a reading's key. */
  signature(value: V): string
  /**
   * A value a member access stands for even when its base is not followed, e.g. any
   * `….integrations`. What the reading meets from it counts; losing it is no gap.
   */
  anchor?(access: PropertyAccessExpression): V | undefined
}

/** One reading session: functions read with the flows they are handed, sharing one bound. */
export interface FlowSession<V extends FlowValue> {
  /** Read `fn` handed `flows` as a first reading; what it returns. */
  read(
    fn: Callable | FunctionFlow<V>,
    flows: ReadonlyArray<Flow<V> | undefined>,
  ): Flow<V> | undefined
  gap(node: Node, reason: string): void
  /** The places the session could not follow, by file and line, once every reading is done. */
  gaps(): SourceGap[]
}

/** What a reading resolves once per Domain, whichever session asks. */
export interface FlowCache {
  /** `nodeKey` of a name → the authored function it declares, or null */
  readonly callables: Map<string, Callable | null>
}

export function flowCache(): FlowCache {
  return { callables: new Map() }
}

/** Built-ins that return the object they are handed, as the reading follows it. */
export const RETURNS_ARGUMENT = new Set([
  'Object.freeze',
  'Object.seal',
  'Object.preventExtensions',
])

/** How far one session follows, so a helper recursing with new closures ends. */
export const MAX_DEPTH = 32
export const MAX_READINGS = 2000

/** A property access's name, or an element access's literal one; undefined when computed. */
export function memberName(access: Node): string | undefined {
  if (Node.isPropertyAccessExpression(access)) return access.getName()
  if (!Node.isElementAccessExpression(access)) return undefined
  const argument = access.getArgumentExpression()
  return argument &&
    (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
    ? argument.getLiteralText()
    : undefined
}

/** An identifier read as a value, not a declared name, a property name or a type. */
function isValueReference(identifier: Node): boolean {
  const parent = identifier.getParent()
  if (!parent) return false
  if (Node.isShorthandPropertyAssignment(parent)) return true
  if (Node.isBindingElement(parent) || Node.isTypeQuery(parent) || Node.isQualifiedName(parent)) {
    return false
  }
  const named = parent as { getNameNode?: () => Node | undefined }
  return named.getNameNode?.() !== identifier
}

function isWrapper(node: Node): boolean {
  return (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isAwaitExpression(node)
  )
}

const LOGICAL = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
])

/** Whether `inner` is written inside `outer`. */
function within(inner: Node, outer: Node): boolean {
  return (
    inner !== outer &&
    inner.getSourceFile() === outer.getSourceFile() &&
    outer.getPos() <= inner.getPos() &&
    inner.getEnd() <= outer.getEnd()
  )
}

/**
 * A node's source as a code span in gap prose: on one line, shortened, and fenced with more
 * backticks than any run it holds, so a template literal still reads as one span.
 */
export function quotedSource(node: Node): string {
  const text = node.getText().replace(/\s+/g, ' ')
  const short = text.length > 48 ? `${text.slice(0, 47)}…` : text
  const fence = '`'.repeat(Math.max(0, ...(short.match(/`+/g) ?? []).map((run) => run.length)) + 1)
  const pad = short.startsWith('`') || short.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${short}${pad}${fence}`
}

/**
 * Start a session reading values in `language`. Gaps are keyed by file and line under
 * `domainRoot`; a function returning what the language holds is a gap only if no
 * reading of it lets its caller read what it returns.
 */
export function flowSession<V extends FlowValue>(
  language: FlowLanguage<V>,
  domainRoot: string,
  cache: FlowCache,
): FlowSession<V> {
  const gaps = new Map<string, SourceGap>()
  // What each reading returns, keyed by the function, its closure and the flows it is
  // handed; undefined while it is read, so a helper calling itself reads once.
  const results = new Map<string, Flow<V> | undefined>()
  // Every function read; see `returns`.
  const readFunctions = new Set<string>()
  const returns: Array<{ owner: Node; at: Node; reason: string }> = []
  // Functions the language reads with the flows it hands them, skipped where written.
  const claimed = new Set<string>()
  const readings = new WeakMap<Scope<V>, Reading<V>>()
  let count = 0

  const holds = (flow: Flow<V>): boolean => {
    if (isFunctionFlow(flow)) return false
    if (isObjectFlow(flow)) return [...flow.properties.values()].some(holds)
    return language.holds(flow)
  }
  const follows = (flow: Flow<V>): boolean => {
    if (isFunctionFlow(flow)) return false
    if (isObjectFlow(flow)) return [...flow.properties.values()].some(follows)
    return language.follows ? language.follows(flow) : language.holds(flow)
  }
  const following = (flow: Flow<V> | undefined) => flow !== undefined && follows(flow)
  const signature = (flow: Flow<V>): string => {
    if (isFunctionFlow(flow)) return `f:${nodeKey(flow.node)}@${flow.closure?.id ?? ''}`
    if (isObjectFlow(flow)) {
      return `{${[...flow.properties]
        .map(([name, value]) => `${name}:${signature(value)}`)
        .sort()
        .join(',')}}`
    }
    return language.signature(flow)
  }

  const gap = (node: Node, reason: string) => {
    const file = relToRoot(domainRoot, node.getSourceFile().getFilePath())
    const line = node.getStartLineNumber()
    gaps.set(`${file}:${line}:${reason}`, { file, line, reason })
  }

  const readingOf = (scope: Scope<V>): Reading<V> => {
    let reading = readings.get(scope)
    if (!reading) {
      reading = {
        scope,
        evaluate: (node) => evaluate(node, scope),
        bind: (name, flow) => bind(name, flow, scope),
        visit: (fn, flows, site) => {
          claimed.add(nodeKey(fn.node))
          return visit(fn, flows, scope, site)
        },
        gap,
      }
      readings.set(scope, reading)
    }
    return reading
  }

  /** A name's flow in the reading it is bound in: this one, or one it closes over. */
  const lookup = (identifier: Node, scope: Scope<V>): Flow<V> | undefined => {
    const name = identifier.getText()
    let declaration: Node | undefined
    for (let reading: Scope<V> | undefined = scope; reading; reading = reading.closure) {
      if (!reading.names.has(name)) continue
      declaration ??= declarationOf(identifier)
      if (!declaration) return undefined
      const flow = reading.flows.get(nodeKey(declaration))
      if (flow) return flow
    }
    return undefined
  }

  /** The names a member access reads: written, or those a computed name stands for. */
  const memberNames = (access: Node, scope: Scope<V>): readonly string[] | undefined => {
    const name = memberName(access)
    if (name !== undefined) return [name]
    if (!Node.isElementAccessExpression(access) || !language.names) return undefined
    const argument = access.getArgumentExpression()
    const value = argument && evaluate(argument, scope)
    return value && isValue(value) ? language.names(value) : undefined
  }

  const member = (flow: Flow<V>, name: string, at: Node, scope: Scope<V>) => {
    if (isObjectFlow(flow)) return flow.properties.get(name)
    if (isFunctionFlow(flow)) return undefined
    return language.member(flow, name, at, readingOf(scope))
  }

  /** What either of two branches gives: objects property by property, values as the language says. */
  const either = (left: Flow<V> | undefined, right: Flow<V> | undefined): Flow<V> | undefined => {
    if (!left) return right && either(right, undefined)
    if (isFunctionFlow(left)) return left
    if (isObjectFlow(left)) {
      const other = right && isObjectFlow(right) ? right.properties : new Map<string, Flow<V>>()
      const properties = new Map<string, Flow<V>>()
      for (const name of new Set([...left.properties.keys(), ...other.keys()])) {
        const flow = either(left.properties.get(name), other.get(name))
        if (flow) properties.set(name, flow)
      }
      return properties.size > 0 ? { kind: 'object', properties } : undefined
    }
    if (!language.either) return left
    return language.either(left, right && isValue(right) ? right : undefined)
  }

  const evaluate = (node: Node, scope: Scope<V>): Flow<V> | undefined => {
    let value = node
    while (isWrapper(value)) value = (value as unknown as { getExpression(): Node }).getExpression()
    if (isFunction(value)) return { kind: 'function', node: value, closure: scope }
    if (Node.isIdentifier(value)) {
      return (
        lookup(value, scope) ??
        functionNamed(value, scope) ??
        language.evaluate?.(value, readingOf(scope))
      )
    }
    if (Node.isPropertyAccessExpression(value) || Node.isElementAccessExpression(value)) {
      const names = memberNames(value, scope)
      const base = names && evaluate(value.getExpression(), scope)
      if (!base) return undefined
      const [first, ...others] = names!.map((name) => member(base, name, value, scope))
      return others.reduce((result, next) => either(result, next), first)
    }
    if (Node.isCallExpression(value)) return resultOf(value, scope)
    if (Node.isConditionalExpression(value)) {
      const decided = language.decide?.(value.getCondition(), readingOf(scope))
      if (decided === true) return evaluate(value.getWhenTrue(), scope)
      if (decided === false) return evaluate(value.getWhenFalse(), scope)
      return either(evaluate(value.getWhenTrue(), scope), evaluate(value.getWhenFalse(), scope))
    }
    if (Node.isBinaryExpression(value) && LOGICAL.has(value.getOperatorToken().getKind())) {
      return either(evaluate(value.getRight(), scope), evaluate(value.getLeft(), scope))
    }
    if (Node.isObjectLiteralExpression(value)) {
      const properties = new Map<string, Flow<V>>()
      for (const property of value.getProperties()) {
        if (Node.isSpreadAssignment(property)) {
          const spread = evaluate(property.getExpression(), scope)
          if (spread && isObjectFlow(spread))
            for (const [name, flow] of spread.properties) properties.set(name, flow)
          continue
        }
        const name = propertyKey(property)
        if (name && Node.isMethodDeclaration(property)) {
          properties.set(name, { kind: 'function', node: property, closure: scope })
          continue
        }
        const carried = Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : Node.isPropertyAssignment(property)
            ? property.getInitializer()
            : undefined
        const flow = name && carried && evaluate(carried, scope)
        if (flow) properties.set(name, flow)
      }
      return properties.size > 0 ? { kind: 'object', properties } : undefined
    }
    return language.evaluate?.(value, readingOf(scope))
  }

  const bind = (name: Node, flow: Flow<V>, scope: Scope<V>) => {
    if (Node.isIdentifier(name)) {
      scope.flows.set(nodeKey(name.getParentOrThrow()), flow)
      scope.names.add(name.getText())
      return
    }
    // an array pattern takes positions, which the reading does not follow
    if (!Node.isObjectBindingPattern(name)) return
    for (const element of name.getElements()) {
      if (element.getDotDotDotToken()) {
        bind(element.getNameNode(), flow, scope)
        continue
      }
      const property = element.getPropertyNameNode()
      if (property && Node.isComputedPropertyName(property)) {
        if (holds(flow)) gap(element, `reads ${language.describe(flow)} by a computed name`)
        continue
      }
      const read =
        property && Node.isStringLiteral(property)
          ? property.getLiteralText()
          : (property?.getText() ?? element.getName())
      const next = member(flow, read, element, scope)
      if (next) bind(element.getNameNode(), next, scope)
    }
  }

  /** Follow a value the language holds up the expressions that use it. */
  const climb = (node: Node, flow: Flow<V>, scope: Scope<V>, quiet: boolean): void => {
    const parent = node.getParent()
    if (!parent) return
    if (isWrapper(parent)) return climb(parent, flow, scope, quiet)
    if (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) {
      if (parent.getExpression() !== node) return
      const names = memberNames(parent, scope)
      if (names === undefined) {
        if (!quiet && holds(flow))
          gap(parent, `reads ${language.describe(flow)} by a computed name`)
        return
      }
      for (const name of names) {
        const next = member(flow, name, parent, scope)
        if (next) climb(parent, next, scope, quiet)
      }
      return
    }
    // a call's arguments are followed where the call is read; see `call`
    if (Node.isCallExpression(parent) || Node.isVariableDeclaration(parent)) return
    if (
      Node.isShorthandPropertyAssignment(parent) ||
      Node.isPropertyAssignment(parent) ||
      Node.isSpreadAssignment(parent)
    ) {
      const object = parent.getParent()
      const carried = !quiet && object && evaluate(object, scope)
      if (carried) climb(object, carried, scope, quiet)
      return
    }
    // an array carries the value on only as far as the language reads arrays
    if (Node.isArrayLiteralExpression(parent) && !quiet) {
      const carried = evaluate(parent, scope)
      if (carried) return climb(parent, carried, scope, quiet)
    }
    if (Node.isConditionalExpression(parent)) {
      if (parent.getCondition() !== node) climb(parent, flow, scope, quiet)
      return
    }
    if (Node.isBinaryExpression(parent)) {
      const operator = parent.getOperatorToken().getKind()
      if (LOGICAL.has(operator)) climb(parent, flow, scope, quiet)
      else if (
        operator === SyntaxKind.EqualsToken &&
        parent.getRight() === node &&
        !quiet &&
        holds(flow)
      ) {
        gap(parent, `stores ${language.describe(flow)} where the reading cannot follow`)
      }
      return
    }
    if (
      quiet ||
      !holds(flow) ||
      Node.isExpressionStatement(parent) ||
      Node.isTypeOfExpression(parent) ||
      Node.isPrefixUnaryExpression(parent) ||
      Node.isVoidExpression(parent) ||
      Node.isIfStatement(parent)
    ) {
      return
    }
    if (Node.isReturnStatement(parent) || isFunction(parent)) {
      // the call that handed this reading its flows reads what it returns; see `visit`
      const owner = isFunction(parent) ? parent : parent.getFirstAncestor(isCallable)
      if (owner && owner !== scope.fn) {
        returns.push({
          owner,
          at: parent,
          reason: `returns ${language.describe(flow)} to a caller the reading does not follow`,
        })
      }
    } else {
      gap(parent, `hands ${language.describe(flow)} on where the reading cannot follow`)
    }
  }

  /** The authored function a name declares, once per name, whichever session reads it. */
  const callableNamed = (identifier: Node): Callable | undefined => {
    const key = nodeKey(identifier)
    let callable = cache.callables.get(key)
    if (callable === undefined) {
      const resolved = valueOfIdentifier(identifier)
      const value = resolved && unwrapExpression(resolved)
      callable = value && isCallable(value) ? value : null
      cache.callables.set(key, callable)
    }
    return callable ?? undefined
  }

  /**
   * The authored function a name declares, as a value: a function declared inside one
   * being read closes over that reading.
   */
  const functionNamed = (identifier: Node, scope: Scope<V>): FunctionFlow<V> | undefined => {
    const callable = callableNamed(identifier)
    if (!callable) return undefined
    let closure: Scope<V> | undefined = scope
    while (closure && !within(callable, closure.fn)) closure = closure.closure
    return { kind: 'function', node: callable, closure }
  }

  /** The authored function a callee is: handed in, or declared by its name. */
  const functionOf = (node: Node, scope: Scope<V>): FunctionFlow<V> | undefined => {
    const flow = evaluate(node, scope)
    return flow && isFunctionFlow(flow) ? flow : undefined
  }

  /**
   * A function written inside a reading, called by name: it closes over that reading's
   * flows, so the call is followed whatever it is handed.
   */
  const closureCalled = (callee: Node, scope: Scope<V>): FunctionFlow<V> | undefined => {
    if (!Node.isIdentifier(callee)) return undefined
    const flow = lookup(callee, scope) ?? functionNamed(callee, scope)
    return flow && isFunctionFlow(flow) && flow.closure ? flow : undefined
  }

  const argumentFlows = (args: readonly Node[], scope: Scope<V>) =>
    args.map((argument) => (Node.isSpreadElement(argument) ? undefined : evaluate(argument, scope)))

  /** The language value a callee is, when it is one: a client's Step runner, a builder verb. */
  const languageCallee = (callee: Node, scope: Scope<V>): V | undefined => {
    if (!Node.isPropertyAccessExpression(callee) && !Node.isElementAccessExpression(callee)) {
      if (!Node.isIdentifier(callee)) return undefined
      const bound = lookup(callee, scope) ?? language.evaluate?.(callee, readingOf(scope))
      return bound && isValue(bound) ? bound : undefined
    }
    const value = evaluate(callee, scope)
    return value && isValue(value) ? value : undefined
  }

  const call = (expression: CallExpression, scope: Scope<V>) => {
    const callee = unwrapExpression(expression.getExpression())
    const args = expression.getArguments()
    const target = languageCallee(callee, scope)
    if (target) {
      const result = language.call?.(target, expression, readingOf(scope))
      if (result && holds(result)) climb(expression, result, scope, false)
      return
    }
    if (RETURNS_ARGUMENT.has(callee.getText())) {
      const flow = args[0] && evaluate(args[0], scope)
      if (flow && holds(flow)) climb(expression, flow, scope, false)
      return
    }
    const flows = argumentFlows(args, scope)
    const helper = flows.some(following) ? functionOf(callee, scope) : closureCalled(callee, scope)
    if (!flows.some(following) && !helper) return
    if (helper) {
      const result = visit(helper, flows, scope, expression)
      if (result && holds(result)) climb(expression, result, scope, false)
      return
    }
    flows.forEach((flow, index) => {
      if (flow && holds(flow)) {
        gap(
          args[index]!,
          `hands ${language.describe(flow)} to ${quotedSource(callee)}, which the reading cannot follow`,
        )
      }
    })
  }

  /** What a call evaluates to: the language's, the object a built-in returns, a helper's. */
  const resultOf = (expression: CallExpression, scope: Scope<V>): Flow<V> | undefined => {
    const callee = unwrapExpression(expression.getExpression())
    const args = expression.getArguments()
    const target = languageCallee(callee, scope)
    if (target) return language.call?.(target, expression, readingOf(scope))
    if (RETURNS_ARGUMENT.has(callee.getText())) return args[0] && evaluate(args[0], scope)
    const flows = argumentFlows(args, scope)
    const helper = flows.some(following) ? functionOf(callee, scope) : closureCalled(callee, scope)
    return helper && visit(helper, flows, scope, expression)
  }

  /** What a function read in `scope` returns: its expression body, or its first return. */
  const returned = (scope: Scope<V>): Flow<V> | undefined => {
    const body = scope.fn.getBody()
    if (!body) return undefined
    if (!Node.isBlock(body)) return evaluate(body, scope)
    let result: Flow<V> | undefined
    body.forEachDescendant((node, traversal) => {
      if (result || isCallable(node)) return traversal.skip()
      if (!Node.isReturnStatement(node)) return
      const expression = node.getExpression()
      result = expression && evaluate(expression, scope)
    })
    return result
  }

  /** Read `fn` handed `flows` by the reading `caller`, at `site`: what it returns. */
  const visit = (
    fn: FunctionFlow<V>,
    flows: ReadonlyArray<Flow<V> | undefined>,
    caller: Scope<V> | undefined,
    site: Node,
  ): Flow<V> | undefined => {
    const key = `${signature(fn)}(${flows.map((flow) => (flow ? signature(flow) : '')).join(',')})`
    if (results.has(key)) return results.get(key)
    const depth = (caller?.depth ?? 0) + 1
    if (depth > MAX_DEPTH || count >= MAX_READINGS) {
      gap(
        site,
        `calls deeper than the reading follows (${MAX_DEPTH} calls, ${MAX_READINGS} functions)`,
      )
      return undefined
    }
    count += 1
    results.set(key, undefined)
    readFunctions.add(nodeKey(fn.node))
    const scope: Scope<V> = {
      fn: fn.node,
      closure: fn.closure,
      id: count,
      depth,
      flows: new Map(),
      names: new Set(),
    }
    fn.node.getParameters().forEach((parameter, index) => {
      const flow = flows[index]
      if (flow) bind(parameter.getNameNode(), flow, scope)
    })
    // In source order: a binding is read before the uses below it.
    fn.node.forEachDescendant((node, traversal) => {
      if (isCallable(node) && claimed.has(nodeKey(node))) {
        traversal.skip()
      } else if (Node.isVariableDeclaration(node)) {
        const initializer = node.getInitializer()
        const flow = initializer && evaluate(initializer, scope)
        if (flow) bind(node.getNameNode(), flow, scope)
      } else if (Node.isCallExpression(node)) {
        call(node, scope)
      } else if (Node.isIdentifier(node)) {
        if (!scope.names.has(node.getText()) || !isValueReference(node)) return
        const flow = evaluate(node, scope)
        if (flow) climb(node, flow, scope, false)
      } else if (Node.isPropertyAccessExpression(node) && language.anchor) {
        const anchored = language.anchor(node)
        if (anchored && !evaluate(node.getExpression(), scope)) climb(node, anchored, scope, true)
      }
    })
    const result = returned(scope)
    results.set(key, result)
    return result
  }

  return {
    read: (fn, flows) => {
      const flow: FunctionFlow<V> =
        fn instanceof Node ? { kind: 'function', node: fn, closure: undefined } : fn
      return visit(flow, flows, undefined, flow.node)
    },
    gap,
    gaps: () => {
      for (const { owner, at, reason } of returns) {
        if (!readFunctions.has(nodeKey(owner))) gap(at, reason)
      }
      returns.length = 0
      return [...gaps.values()].sort((left, right) =>
        left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
      )
    },
  }
}
