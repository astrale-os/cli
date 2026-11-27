/**
 * Source links for the Integrations a Domain's runtime declares, and the operations
 * each handler reaches through its context. Nothing in the SDK declares which handler
 * uses which operation: this reading follows the clients where they go and names the
 * places it cannot follow instead of guessing.
 */
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
} from 'ts-morph'

import type {
  IntegrationLink,
  IntegrationOperationLink,
  IntegrationReplay,
  SourceGap,
} from '../../../shared/contracts/schema'

import {
  RETURNS_ARGUMENT,
  flowCache,
  flowSession,
  isCallable,
  isFunctionFlow,
  type Flow,
  type FlowCache,
  type FlowLanguage,
} from './flow'
import {
  authoredTypeScriptFiles,
  bindingName,
  curriedFactory,
  isFunction,
  leadingDoc,
  nodeKey,
  objectPropertyValue,
  propertyKey,
  relToRoot,
  stringLiteralOfProp,
  tryAddFile,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

const REPLAY_ORDER: readonly IntegrationReplay[] = ['safe', 'keyed', 'unsafe']

/** The value behind an expression, through identifiers, imports and `Object.freeze(…)`. */
function valueOf(node: Node, seen = new Set<string>()): Node | undefined {
  const value = unwrapExpression(node)
  const key = nodeKey(value)
  if (seen.has(key)) return undefined
  seen.add(key)
  if (Node.isIdentifier(value)) {
    const resolved = valueOfIdentifier(value)
    return resolved && valueOf(resolved, seen)
  }
  if (Node.isCallExpression(value) && RETURNS_ARGUMENT.has(value.getExpression().getText())) {
    const argument = value.getArguments()[0]
    return argument && valueOf(argument, seen)
  }
  return value
}

function objectOf(node: Node | undefined): ObjectLiteralExpression | undefined {
  const value = node && valueOf(node)
  return value && Node.isObjectLiteralExpression(value) ? value : undefined
}

function propertyValue(object: ObjectLiteralExpression, name: string): Node | undefined {
  const property = object.getProperty(name)
  return property && objectPropertyValue(property)
}

/** The decisions a `replay` can take: a decision, or a function of the input returning them. */
function replayOf(replay: Node | undefined): IntegrationReplay[] {
  const decision = replay && valueOf(replay)
  if (!decision) return []
  const kinds = new Set<IntegrationReplay>()
  let unknown = false
  const read = (node: Node) => {
    const value = unwrapExpression(node)
    if (Node.isConditionalExpression(value)) {
      read(value.getWhenTrue())
      read(value.getWhenFalse())
      return
    }
    const kind = stringLiteralOfProp(objectOf(value) ?? value, 'kind')
    if (kind === 'safe' || kind === 'keyed' || kind === 'unsafe') kinds.add(kind)
    else unknown = true
  }
  if (Node.isArrowFunction(decision) || Node.isFunctionExpression(decision)) {
    const body = decision.getBody()
    if (!Node.isBlock(body)) read(body)
    for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (statement.getFirstAncestor(isFunction) !== decision) continue
      const returned = statement.getExpression()
      if (returned) read(returned)
    }
  } else {
    read(decision)
  }
  return unknown ? [] : REPLAY_ORDER.filter((kind) => kinds.has(kind))
}

function isOperationDeclaration(call: CallExpression): boolean {
  const callee = unwrapExpression(call.getExpression())
  return (
    Node.isPropertyAccessExpression(callee) &&
    callee.getName() === 'operation' &&
    callee.getExpression().getText() === 'defineIntegration'
  )
}

/** One `key: contract` entry of the runtime's Integrations, read from its `defineIntegration`. */
function readIntegration(
  domainRoot: string,
  key: string,
  value: Node | undefined,
): IntegrationLink {
  const link: IntegrationLink = { key }
  const declaration = value && valueOf(value)
  if (
    !declaration ||
    !Node.isCallExpression(declaration) ||
    unwrapExpression(declaration.getExpression()).getText() !== 'defineIntegration'
  ) {
    return link
  }
  link.file = relToRoot(domainRoot, declaration.getSourceFile().getFilePath())
  link.line = declaration.getStartLineNumber()
  const name = bindingName(declaration)
  if (name) link.name = name
  const statement = declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement)
  const doc = statement ? leadingDoc(statement) : undefined
  if (doc) link.doc = doc
  const options = objectOf(declaration.getArguments()[0])
  if (!options) return link
  const id = stringLiteralOfProp(options, 'id')
  if (id) link.id = id
  const operations = objectOf(propertyValue(options, 'operations'))
  if (!operations) return link
  const read: IntegrationOperationLink[] = []
  for (const property of operations.getProperties()) {
    const operation = propertyKey(property)
    // a spread or a computed name: the operations are not all known
    if (!operation) return link
    const value = objectPropertyValue(property)
    const call = value && valueOf(value)
    const declared =
      call && Node.isCallExpression(call) && isOperationDeclaration(call)
        ? objectOf(call.getArguments()[0])
        : undefined
    read.push({
      name: operation,
      replay: replayOf(declared && propertyValue(declared, 'replay')),
      line: property.getStartLineNumber(),
    })
  }
  link.operations = read.sort((left, right) => left.name.localeCompare(right.name))
  return link
}

/**
 * The Integrations the Domain's runtime declares: `defineRuntime()({ integrations })`,
 * one link per key its handlers reach a client by.
 */
export function readIntegrations(args: {
  domainRoot: string
  project: Project
}): IntegrationLink[] {
  const { domainRoot, project } = args
  if (!domainRoot) return []
  const sources = authoredTypeScriptFiles(domainRoot)
    .map((file) => tryAddFile(project, file))
    .filter((source): source is SourceFile => source !== undefined)
  const byKey = new Map<string, IntegrationLink>()
  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (curriedFactory(call) !== 'defineRuntime') continue
      const options = objectOf(call.getArguments()[0])
      const integrations = options && objectOf(propertyValue(options, 'integrations'))
      if (!integrations) continue
      for (const property of integrations.getProperties()) {
        const key = propertyKey(property)
        if (!key || byKey.has(key)) continue
        byKey.set(key, readIntegration(domainRoot, key, objectPropertyValue(property)))
      }
    }
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key))
}

/**
 * What a value holds of the Integrations: all the clients (`context.integrations`), one
 * client, the Steps (whose callbacks receive the clients), or a Step's runner.
 */
type Reach =
  | { readonly kind: 'clients' }
  | { readonly kind: 'client'; readonly key: string }
  | { readonly kind: 'steps' }
  | { readonly kind: 'run' }

const CLIENTS: Reach = { kind: 'clients' }
const STEPS: Reach = { kind: 'steps' }
const RUN: Reach = { kind: 'run' }
/** A handler's context. */
const CONTEXT: Flow<Reach> = {
  kind: 'object',
  properties: new Map<string, Flow<Reach>>([
    ['integrations', CLIENTS],
    ['step', STEPS],
  ]),
}
/** What a Step's callback receives: its own, replayable clients. */
const AUTHORITY: Flow<Reach> = { kind: 'object', properties: new Map([['integrations', CLIENTS]]) }

export interface IntegrationReach {
  /** `key.operation`, sorted */
  uses: string[]
  gaps: SourceGap[]
}

/**
 * The Integration operations a handler reaches: through its context and every
 * renaming, destructuring, Step callback and authored helper the clients are handed
 * to, back out of what such a helper returns, and into the functions it writes, each
 * reading the names it closes over where it was written. A client read by a computed
 * name, or handed where the reading cannot follow, is a gap. Any
 * `….integrations.<key>.<operation>` written in a followed function counts too,
 * whatever the reading lost on the way to it.
 */
export function integrationReachReader(
  integrations: readonly IntegrationLink[],
  domainRoot: string,
  cache: FlowCache = flowCache(),
): (handler: Node) => IntegrationReach {
  // undefined: the Integration's operations could not be read, so any name is one
  const operationsByKey = new Map<string, ReadonlySet<string> | undefined>(
    integrations.map((link) => [
      link.key,
      link.operations && new Set(link.operations.map((operation) => operation.name)),
    ]),
  )
  const isOperation = (key: string, name: string) => {
    const operations = operationsByKey.get(key)
    return operations === undefined || operations.has(name)
  }

  return (handler) => {
    if (operationsByKey.size === 0 || !isCallable(handler)) return { uses: [], gaps: [] }
    const uses = new Set<string>()
    const language: FlowLanguage<Reach> = {
      member: (value, name) => {
        if (value.kind === 'clients')
          return operationsByKey.has(name) ? { kind: 'client', key: name } : undefined
        // a client's member is an operation it uses
        if (value.kind === 'client') {
          if (isOperation(value.key, name)) uses.add(`${value.key}.${name}`)
          return undefined
        }
        return value.kind === 'steps' && name === 'run' ? RUN : undefined
      },
      // `step.run(id, (authority) => …)`: the callback receives the Step's clients
      call: (value, expression, reading) => {
        if (value.kind !== 'run') return undefined
        const execute = expression.getArguments()[1]
        const callback = execute && unwrapExpression(execute)
        if (callback && isFunction(callback)) {
          const parameter = callback.getParameters()[0]
          if (parameter) reading.bind(parameter.getNameNode(), AUTHORITY)
        } else if (execute) {
          const helper = reading.evaluate(execute)
          if (helper && isFunctionFlow(helper)) reading.visit(helper, [AUTHORITY], execute)
          else
            reading.gap(
              execute,
              `hands the Steps' Integrations to \`${execute.getText()}\`, which the reading cannot follow`,
            )
        }
        return undefined
      },
      holds: (value) => value.kind !== 'run',
      describe: (flow) => {
        switch (flow.kind) {
          case 'clients':
            return 'the Integrations'
          case 'client':
            return `the ${flow.key} Integration`
          case 'steps':
            return 'the Steps'
          case 'run':
            return "the Steps' runner"
          case 'function':
            return 'a function'
          case 'object':
            return flow.properties.has('integrations')
              ? 'the context'
              : 'an object holding the Integrations'
        }
      },
      signature: (value) => {
        switch (value.kind) {
          case 'clients':
            return 'C'
          case 'client':
            return `c:${value.key}`
          case 'steps':
            return 'S'
          case 'run':
            return 'R'
        }
      },
      anchor: (access) => (access.getName() === 'integrations' ? CLIENTS : undefined),
    }
    const session = flowSession(language, domainRoot, cache)
    session.read(handler, [CONTEXT])
    return { uses: [...uses].sort(), gaps: session.gaps() }
  }
}
