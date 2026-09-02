/**
 * project-config.ts — rewrite a domain's `astrale.config.ts` from the retired bare
 * `export default deploy({ ... })` to the Project the SDK now requires:
 *
 *   export default defineProject({ deployment: deploy({ ... }) })
 *
 * Text edits are positioned by ts-morph, so authored comments, indentation and the
 * adapter block survive untouched; only the export expression is wrapped (and
 * re-indented one level) and one import line is added. Anything that is not exactly
 * `deploy({ ... })` with one object argument is reported as unsupported for a manual
 * migration rather than guessed at.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type CallExpression, Node, Project, type SourceFile } from 'ts-morph'

export const PROJECT_CONFIG_FILE = 'astrale.config.ts'
const DEPLOY_MODULES = new Set(['@astrale-os/sdk/deployment', '@astrale-os/sdk'])
const PROJECT_MODULE = '@astrale-os/sdk/project'

export type ProjectConfigMigration =
  /** already `defineProject(...)` */
  | { status: 'current' }
  /** a bare `deploy({ ... })` export; `source` is the rewritten file */
  | { status: 'migrated'; source: string }
  /** no default export, or a shape the codemod refuses to guess at */
  | { status: 'unsupported'; reason: string }

function unwrap(node: Node): Node {
  let current = node
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression()
  }
  return current
}

/** The local name under which `name` is imported from one of `modules`, if any. */
function importedLocalName(
  source: SourceFile,
  name: string,
  modules: ReadonlySet<string>,
): string | null {
  for (const declaration of source.getImportDeclarations()) {
    if (!modules.has(declaration.getModuleSpecifierValue())) continue
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === name) return named.getAliasNode()?.getText() ?? name
    }
  }
  return null
}

function calleeName(call: CallExpression): string | null {
  const expression = call.getExpression()
  return Node.isIdentifier(expression) ? expression.getText() : null
}

/** Rewrite one configuration source, or explain why it cannot be rewritten mechanically. */
export function migrateProjectConfigSource(text: string): ProjectConfigMigration {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true })
  const source = project.createSourceFile(PROJECT_CONFIG_FILE, text)
  const exportAssignment = source.getExportAssignment((entry) => !entry.isExportEquals())
  if (!exportAssignment) {
    return { status: 'unsupported', reason: 'astrale.config.ts has no default export' }
  }
  const expression = unwrap(exportAssignment.getExpression())
  if (!Node.isCallExpression(expression)) {
    return { status: 'unsupported', reason: 'the default export is not a deploy({ ... }) call' }
  }
  const callee = calleeName(expression)
  const defineProjectLocal = importedLocalName(source, 'defineProject', new Set([PROJECT_MODULE]))
  if (callee !== null && callee === defineProjectLocal) return { status: 'current' }
  const deployLocal = importedLocalName(source, 'deploy', DEPLOY_MODULES)
  if (callee === null || callee !== deployLocal) {
    return {
      status: 'unsupported',
      reason: 'the default export is not the deploy() imported from @astrale-os/sdk/deployment',
    }
  }
  const args = expression.getArguments()
  if (args.length !== 1 || !Node.isObjectLiteralExpression(unwrap(args[0]!))) {
    return {
      status: 'unsupported',
      reason:
        'the default export is not deploy({ application, entrypoint, adapter }) — the legacy deploy(domain, adapter) form needs a manual migration',
    }
  }

  const original = expression.getText()
  const [first, ...rest] = original.split('\n')
  const nested = [first, ...rest.map((line) => (line.length === 0 ? line : `  ${line}`))].join('\n')
  const wrapped = `defineProject({\n  deployment: ${nested},\n})`
  const importLine = `import { defineProject } from '${PROJECT_MODULE}'`
  const deployImport = source
    .getImportDeclarations()
    .find((declaration) => DEPLOY_MODULES.has(declaration.getModuleSpecifierValue()))
  const anchor = deployImport ?? source.getImportDeclarations().at(-1)

  // Apply from the end of the file backwards so earlier positions stay valid.
  let output = text
  output = output.slice(0, expression.getStart()) + wrapped + output.slice(expression.getEnd())
  if (anchor) {
    const at = anchor.getEnd()
    output = `${output.slice(0, at)}\n${importLine}${output.slice(at)}`
  } else {
    output = `${importLine}\n${output}`
  }
  return { status: 'migrated', source: output }
}

/** Inspect the project's configuration on disk without writing. */
export function inspectProjectConfig(root: string): ProjectConfigMigration | null {
  const file = join(root, PROJECT_CONFIG_FILE)
  if (!existsSync(file)) return null
  return migrateProjectConfigSource(readFileSync(file, 'utf8'))
}

/** Rewrite the project's configuration on disk; true when the file changed. */
export function migrateProjectConfigFile(root: string): ProjectConfigMigration | null {
  const migration = inspectProjectConfig(root)
  if (migration?.status === 'migrated') {
    writeFileSync(join(root, PROJECT_CONFIG_FILE), migration.source)
  }
  return migration
}
