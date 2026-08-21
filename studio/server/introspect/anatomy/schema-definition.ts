import { join } from 'node:path'
import { Node, type SourceFile, SyntaxKind } from 'ts-morph'

import { addSource, listSourceFiles, literalString, makeProject } from './source'

// Canonical schema source discovery.

export interface SchemaDefinitionLocation {
  origin: string
  file: string
  line: number
}

export function schemaProject(root: string, schemaDirName: string): SourceFile[] {
  const project = makeProject()
  return listSourceFiles(join(root, schemaDirName))
    .map((file) => addSource(project, file))
    .filter((source): source is SourceFile => source !== null)
}

export function defineSchemaCalls(source: SourceFile) {
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const expression = call.getExpression()
    return (
      (Node.isIdentifier(expression) && expression.getText() === 'defineSchema') ||
      (Node.isPropertyAccessExpression(expression) && expression.getName() === 'defineSchema')
    )
  })
}

/**
 * Find the accepted schema without importing it. Current project roots are
 * barrels, so all authored schema modules are inspected and local origin
 * constants such as `defineSchema(ORIGIN, ...)` are resolved.
 */
export function findSchemaDefinition(
  root: string,
  schemaDirName = 'schema',
): SchemaDefinitionLocation | null {
  for (const source of schemaProject(root, schemaDirName)) {
    for (const call of defineSchemaCalls(source)) {
      const origin = literalString(call.getArguments()[0], source)
      if (!origin) continue
      const statement = call.getFirstAncestorByKind(SyntaxKind.VariableStatement)
      return {
        origin,
        file: source.getFilePath(),
        line: statement?.getStartLineNumber() ?? call.getStartLineNumber(),
      }
    }
  }
  return null
}
