/** Source links for SDK V1 Action and Workflow declarations. */
import { Node, SyntaxKind, type CallExpression, type Project, type SourceFile } from 'ts-morph'

import type { HandlerLink, IntegrationLink, SchemaIR } from '../../../shared/contracts/schema'
import type { FlowCache } from './flow'

import { integrationReachReader } from './integrations'
import { scanKernelCalls } from './kernel-calls'
import {
  authoredTypeScriptFiles,
  curriedFactory,
  isFunction,
  newProject,
  nodeKey,
  relToRoot,
  stringArgument,
  tryAddFile,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

interface CallableOwner {
  owner: string
  ownerKind: 'class' | 'function'
  method: string
  static: boolean
}

function declaredCallable(ir: SchemaIR | null, key: string): CallableOwner | undefined {
  if (!ir) return undefined
  const standalone = ir.functions[key]
  if (standalone) {
    return {
      owner: ir.domain,
      ownerKind: 'function',
      method: key,
      static: true,
    }
  }
  const separator = key.lastIndexOf('.')
  if (separator <= 0) return undefined
  const owner = key.slice(0, separator)
  const method = key.slice(separator + 1)
  const definition = ir.classes[owner]?.methods[method]
  return definition
    ? {
        owner,
        ownerKind: 'class',
        method,
        static: definition.static,
      }
    : undefined
}

function declarationKind(call: CallExpression): 'action' | 'workflow' | undefined {
  const factory = curriedFactory(call)
  if (factory === 'defineAction') return 'action'
  if (factory === 'defineWorkflow') return 'workflow'
  return undefined
}

function resolveHandler(node: Node): Node {
  let current = unwrapExpression(node)
  if (Node.isIdentifier(current)) current = unwrapExpression(valueOfIdentifier(current) ?? current)
  return current
}

/** Names a source file binds at module scope: its imports and top-level declarations. */
function moduleBindings(source: SourceFile): Set<string> {
  const names = new Set<string>()
  for (const declaration of source.getImportDeclarations()) {
    for (const named of declaration.getNamedImports()) {
      names.add(named.getAliasNode()?.getText() ?? named.getName())
    }
  }
  for (const variable of source.getVariableDeclarations()) names.add(variable.getName())
  for (const declared of source.getFunctions()) {
    const name = declared.getName()
    if (name) names.add(name)
  }
  return names
}

/**
 * The callables a function names as `Class.methods.m` or `Class.static.methods.m`,
 * keyed `Class.m`. A source reading: handing a callable on is how a handler calls it,
 * while reading one of its fields (`….methods.m.key`) only names it.
 */
function namedCallables(body: Node, ir: SchemaIR | null): string[] {
  if (!ir) return []
  const keys = new Set<string>()
  for (const access of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const methods = access.getExpression()
    if (!Node.isPropertyAccessExpression(methods) || methods.getName() !== 'methods') continue
    const parent = access.getParent()
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === access) continue
    let owner = methods.getExpression()
    if (Node.isPropertyAccessExpression(owner) && owner.getName() === 'static') {
      owner = owner.getExpression()
    }
    const ownerName = Node.isPropertyAccessExpression(owner)
      ? owner.getName()
      : Node.isIdentifier(owner)
        ? owner.getText()
        : undefined
    const method = access.getName()
    if (ownerName && ir.classes[ownerName]?.methods[method]) keys.add(`${ownerName}.${method}`)
  }
  return [...keys]
}

/** What one function names itself; a handler reaches the closure of it over its helpers. */
interface DirectReach {
  definitions: string[]
  calls: string[]
  helpers: Node[]
}

/**
 * The Query and Mutation definitions and the callables a handler reaches: those it
 * names, and those the authored functions it calls name, however deep. A definition
 * or helper is reached through a module binding (`import { deleteComment } from
 * '#mutations/…'`), whatever call carries it: `query(…)`, `context.step.mutate(…)`.
 */
function reachReader(
  ir: SchemaIR | null,
  definitionIds: ReadonlyMap<string, string>,
): (handler: Node) => { definitions: string[]; calls: string[] } {
  const bindingsByFile = new Map<string, Set<string>>()
  // One resolution per module binding, however many functions the module holds.
  const valueByBinding = new Map<string, Node | undefined>()
  const direct = new Map<string, DirectReach>()

  const valueOf = (source: SourceFile, identifier: Node) => {
    const key = `${source.getFilePath()}:${identifier.getText()}`
    if (!valueByBinding.has(key)) {
      const value = valueOfIdentifier(identifier)
      valueByBinding.set(key, value && unwrapExpression(value))
    }
    return valueByBinding.get(key)
  }

  const directReach = (body: Node): DirectReach => {
    const self = nodeKey(body)
    const known = direct.get(self)
    if (known) return known
    const source = body.getSourceFile()
    let bindings = bindingsByFile.get(source.getFilePath())
    if (!bindings) {
      bindings = moduleBindings(source)
      bindingsByFile.set(source.getFilePath(), bindings)
    }
    const definitions = new Set<string>()
    const helpers = new Map<string, Node>()
    for (const identifier of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (!bindings.has(identifier.getText())) continue
      const value = valueOf(source, identifier)
      if (!value) continue
      const key = nodeKey(value)
      const id = definitionIds.get(key)
      if (id) definitions.add(id)
      else if (key !== self && isFunction(value)) helpers.set(key, value)
    }
    const reach = {
      definitions: [...definitions],
      calls: namedCallables(body, ir),
      helpers: [...helpers.values()],
    }
    direct.set(self, reach)
    return reach
  }

  return (handler) => {
    const definitions = new Set<string>()
    const calls = new Set<string>()
    // Helpers may call each other in a cycle: each is read once per handler.
    const seen = new Set<string>()
    const visit = (body: Node) => {
      const key = nodeKey(body)
      if (seen.has(key)) return
      seen.add(key)
      const reach = directReach(body)
      for (const id of reach.definitions) definitions.add(id)
      for (const call of reach.calls) calls.add(call)
      for (const helper of reach.helpers) visit(helper)
    }
    visit(handler)
    return { definitions: [...definitions].sort(), calls: [...calls].sort() }
  }
}

function isStubHandler(node: Node): boolean {
  if (
    !Node.isArrowFunction(node) &&
    !Node.isFunctionExpression(node) &&
    !Node.isFunctionDeclaration(node) &&
    !Node.isMethodDeclaration(node)
  ) {
    return false
  }
  const body = node.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  return statements.length > 0 && statements.every(Node.isThrowStatement)
}

/**
 * Discover modular `defineAction()` and `defineWorkflow()` declarations. Runtime
 * admission remains authoritative for exhaustiveness; this is a source overlay.
 */
export function buildHandlerLinks(args: {
  ir: SchemaIR | null
  domainRoot: string
  /** Shared with the span reading — see buildOverlay. */
  project?: Project
  /** `nodeKey` of each Query/Mutation declaration → its id; see readDefinitions. */
  definitionIds?: ReadonlyMap<string, string>
  /** The runtime's Integrations; see readIntegrations. */
  integrations?: readonly IntegrationLink[]
  /** Shared with the definition reading — see buildOverlay. */
  cache?: FlowCache
}): HandlerLink[] {
  const { ir, domainRoot } = args
  if (!domainRoot) return []
  const project = args.project ?? newProject()
  // Walk the files THIS reading owns, not everything the project happens to hold:
  // the project is shared, and the span reading adds test files this one excludes.
  const sources = authoredTypeScriptFiles(domainRoot)
    .map((file) => tryAddFile(project, file))
    .filter((source): source is SourceFile => source !== undefined)
  const links = new Map<string, HandlerLink>()
  // Several declarations commonly share one handler module; read and scan it once.
  const kernelCallsByFile = new Map<string, string[]>()
  const kernelCallsOf = (file: string) => {
    let calls = kernelCallsByFile.get(file)
    if (!calls) {
      calls = scanKernelCalls(file)
      kernelCallsByFile.set(file, calls)
    }
    return calls
  }
  const reachOf = reachReader(ir, args.definitionIds ?? new Map())
  const integrationsOf = integrationReachReader(args.integrations ?? [], domainRoot, args.cache)

  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const kind = declarationKind(call)
      if (!kind) continue
      const key = stringArgument(call, 0)
      // `(key, handler)` or `(key, options, handler)`: the handler comes last.
      const handlerArgument = call.getArguments().slice(1).at(-1)
      if (!key || !handlerArgument) continue
      const callable = declaredCallable(ir, key)
      if (!callable) continue
      const handler = resolveHandler(handlerArgument)
      const handlerPath = handler.getSourceFile().getFilePath()
      const handlerFile = relToRoot(domainRoot, handlerPath)
      const link: HandlerLink = {
        ...callable,
        kind,
        // the declaration itself; the handler may be imported from another module
        wiringFile: relToRoot(domainRoot, source.getFilePath()),
        wiringLine: call.getStartLineNumber(),
        handlerFile,
        handlerLine: handler.getStartLineNumber(),
        implemented: !isStubHandler(handler),
      }
      const kernelCalls = kernelCallsOf(handlerPath)
      if (kernelCalls.length > 0) link.kernelCalls = kernelCalls
      const reach = reachOf(handler)
      if (reach.definitions.length > 0) link.definitions = reach.definitions
      const self = `${callable.owner}.${callable.method}`
      const calls = reach.calls.filter((key) => key !== self)
      if (calls.length > 0) link.calls = calls
      const integrations = integrationsOf(handler)
      if (integrations.uses.length > 0) link.integrations = integrations.uses
      if (integrations.gaps.length > 0) link.integrationGaps = integrations.gaps
      links.set(`${callable.ownerKind}:${callable.owner}.${callable.method}`, link)
    }
  }

  return [...links.values()].sort((left, right) =>
    left.owner === right.owner
      ? left.method.localeCompare(right.method)
      : left.owner.localeCompare(right.owner),
  )
}
