/** Source links for SDK V1 Query and Mutation definitions. */
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ParameterDeclaration,
  type Project,
  type SourceFile,
} from 'ts-morph'

import type { DefinitionLink } from '../../../shared/contracts/schema'

import {
  authoredTypeScriptFiles,
  curriedFactory,
  leadingDoc,
  nodeKey,
  objectPropertyValue,
  relToRoot,
  stringArgument,
  tryAddFile,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

export interface DefinitionReading {
  definitions: DefinitionLink[]
  /** `nodeKey` of each `define…()(…)` call → its declared id. */
  idByDeclaration: Map<string, string>
}

function definitionKind(call: CallExpression): DefinitionLink['kind'] | undefined {
  const factory = curriedFactory(call)
  if (factory === 'defineQuery') return 'query'
  if (factory === 'defineMutation') return 'mutation'
  return undefined
}

/** The `build` callable of the options object, written as a property or a method. */
function buildCallable(call: CallExpression): Node | undefined {
  const options = call.getArguments()[1]
  if (!options) return undefined
  const value = unwrapExpression(options)
  if (!Node.isObjectLiteralExpression(value)) return undefined
  const property = value.getProperty('build')
  const build = property && objectPropertyValue(property)
  if (!build) return undefined
  const callable = unwrapExpression(build)
  return Node.isIdentifier(callable) ? valueOfIdentifier(callable) : callable
}

function parametersOf(callable: Node): ParameterDeclaration[] {
  return Node.isArrowFunction(callable) ||
    Node.isFunctionExpression(callable) ||
    Node.isMethodDeclaration(callable)
    ? callable.getParameters()
    : []
}

/**
 * The Classes a `build` names through its second parameter: destructured
 * (`{ Issue, issue_has_comment }`) or read as members (`classes.Issue`).
 */
function namedClasses(callable: Node): string[] {
  const parameter = parametersOf(callable)[1]
  if (!parameter) return []
  const binding = parameter.getNameNode()
  if (Node.isObjectBindingPattern(binding)) {
    return binding
      .getElements()
      .map((element) => element.getPropertyNameNode()?.getText() ?? element.getName())
  }
  if (!Node.isIdentifier(binding)) return []
  const name = binding.getText()
  const names = new Set<string>()
  for (const access of callable.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (access.getExpression().getText() === name) names.add(access.getName())
  }
  return [...names]
}

/** The exported binding that holds the definition: `export const deleteComment = …`. */
function bindingName(call: CallExpression): string | undefined {
  const declaration = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  return declaration && unwrapExpression(declaration.getInitializer() ?? declaration) === call
    ? declaration.getName()
    : undefined
}

/**
 * Discover `defineQuery()` and `defineMutation()` declarations anywhere in the
 * Domain's authored sources. The ids are the Domain's own; nothing is admitted.
 */
export function readDefinitions(args: { domainRoot: string; project: Project }): DefinitionReading {
  const { domainRoot, project } = args
  const definitions: DefinitionLink[] = []
  const idByDeclaration = new Map<string, string>()
  if (!domainRoot) return { definitions, idByDeclaration }
  const sources = authoredTypeScriptFiles(domainRoot)
    .map((file) => tryAddFile(project, file))
    .filter((source): source is SourceFile => source !== undefined)

  for (const source of sources) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const kind = definitionKind(call)
      if (!kind) continue
      const id = stringArgument(call, 0)
      if (!id || idByDeclaration.has(nodeKey(call))) continue
      const build = buildCallable(call)
      const name = bindingName(call)
      const statement = call.getFirstAncestorByKind(SyntaxKind.VariableStatement)
      const doc = statement ? leadingDoc(statement) : undefined
      const link: DefinitionLink = {
        kind,
        id,
        file: relToRoot(domainRoot, source.getFilePath()),
        line: call.getStartLineNumber(),
        classes: build ? namedClasses(build) : [],
      }
      if (name) link.name = name
      if (doc) link.doc = doc
      definitions.push(link)
      idByDeclaration.set(nodeKey(call), id)
    }
  }

  definitions.sort((left, right) => left.id.localeCompare(right.id))
  return { definitions, idByDeclaration }
}
