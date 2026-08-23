/** Source links for SDK V1 Action and Workflow declarations. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Node, SyntaxKind, type CallExpression } from 'ts-morph'

import type { HandlerLink, SchemaIR } from '../../../shared/types'

import { scanKernelCalls } from './kernel-calls'
import { newProject, relToRoot, unwrapExpression, valueOfIdentifier } from './project'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.history',
  '.astrale',
  '.cache',
  '__tests__',
  'dist',
  'node_modules',
])

function authoredTypeScriptFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(path)
      } else if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts')) {
        files.push(path)
      }
    }
  }
  visit(root)
  return files
}

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
  const expression = unwrapExpression(call.getExpression())
  if (!Node.isCallExpression(expression)) return undefined
  const factory = unwrapExpression(expression.getExpression())
  if (!Node.isIdentifier(factory)) return undefined
  if (factory.getText() === 'defineAction') return 'action'
  if (factory.getText() === 'defineWorkflow') return 'workflow'
  return undefined
}

function stringArgument(call: CallExpression, index: number): string | undefined {
  const argument = call.getArguments()[index]
  return argument &&
    (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
    ? argument.getLiteralText()
    : undefined
}

function resolveHandler(node: Node): Node {
  let current = unwrapExpression(node)
  if (Node.isIdentifier(current)) current = unwrapExpression(valueOfIdentifier(current) ?? current)
  return current
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
}): HandlerLink[] {
  const { ir, domainRoot } = args
  if (!domainRoot) return []
  const project = newProject()
  for (const file of authoredTypeScriptFiles(domainRoot)) project.addSourceFileAtPath(file)
  const links = new Map<string, HandlerLink>()

  for (const source of project.getSourceFiles()) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const kind = declarationKind(call)
      if (!kind) continue
      const key = stringArgument(call, 0)
      const handlerArgument = call.getArguments()[1]
      if (!key || !handlerArgument) continue
      const callable = declaredCallable(ir, key)
      if (!callable) continue
      const handler = resolveHandler(handlerArgument)
      const handlerFile = relToRoot(domainRoot, handler.getSourceFile().getFilePath())
      const link: HandlerLink = {
        ...callable,
        kind,
        wiringFile: handlerFile,
        wiringLine: call.getStartLineNumber(),
        handlerFile,
        handlerLine: handler.getStartLineNumber(),
        implemented: !isStubHandler(handler),
      }
      const kernelCalls = scanKernelCalls(handler.getSourceFile().getFilePath())
      if (kernelCalls.length > 0) link.kernelCalls = kernelCalls
      links.set(`${callable.ownerKind}:${callable.owner}.${callable.method}`, link)
    }
  }

  return [...links.values()].sort((left, right) =>
    left.owner === right.owner
      ? left.method.localeCompare(right.method)
      : left.owner.localeCompare(right.owner),
  )
}
