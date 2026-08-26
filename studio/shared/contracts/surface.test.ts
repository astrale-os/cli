import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const SHARED_ROOT = resolve(import.meta.dir, '..')
const STUDIO_ROOT = resolve(SHARED_ROOT, '..')

// Closed Studio V1 shared surface. Keeping this manifest independent of Git
// catches accidental aliases and shadow contracts.
const TARGET_BARREL_EXPORTS = [
  'AGENT_ACCESS_LEVELS',
  'AGENT_EFFORT_LEVELS',
  'AgentAccess',
  'AgentEffort',
  'AgentEvent',
  'AgentEventKind',
  'AgentPromptSnapshot',
  'AgentRun',
  'AgentRunSnapshot',
  'AgentRunStatus',
  'AgentSessionInfo',
  'AgentSystemPromptInfo',
  'AnchorKind',
  'AnchorRef',
  'BundleError',
  'ChangeSet',
  'ClientFeature',
  'ClientTree',
  'Comment',
  'CommentStore',
  'ContextItem',
  'ContextStore',
  'ConversationInfo',
  'CopyPayload',
  'DeployRecord',
  'DeployResult',
  'DocMeta',
  'DomainAnatomy',
  'DomainCatalogEntry',
  'DomainOverview',
  'DomainSummary',
  'DomainUsage',
  'EnvField',
  'EnvFileModel',
  'EnvName',
  'EnvVarRow',
  'FileChange',
  'HandlerLink',
  'HarnessCapabilities',
  'HarnessGatewayAuth',
  'HarnessGatewayConfig',
  'HarnessGatewayState',
  'HarnessLoadout',
  'HarnessModelOption',
  'HarnessStatus',
  'InstanceInfo',
  'InstanceStatus',
  'InstancesState',
  'Integration',
  'IntegrationsState',
  'IrCallable',
  'IrCallableAuth',
  'IrCallableOutput',
  'IrClass',
  'IrClassKey',
  'IrClassRef',
  'IrEndpoint',
  'IrFunction',
  'IrImportDescriptor',
  'IrMethod',
  'IrSchemaKey',
  'IrSchemaRef',
  'IrView',
  'IrViewTarget',
  'JsonSchema',
  'LayoutState',
  'LoadoutSkill',
  'McpServerInfo',
  'MergeResult',
  'MethodInheritance',
  'NodePosition',
  'RememberedViewTarget',
  'SchemaChange',
  'SchemaChangeKind',
  'SchemaIR',
  'SchemaOverlay',
  'SourceSpan',
  'StaleReport',
  'StudioCore',
  'StudioCoreEdge',
  'StudioCoreNode',
  'StudioEvent',
  'StudioSchemaBundle',
  'StudioSettings',
  'ThreadEntry',
  'ThreadEntryType',
  'ThreadRole',
  'TypeDescriptor',
  'ViewInfo',
  'ViewRuntime',
  'ViewSessionResult',
  'ViewTargetCandidate',
  'ViewTargetResult',
  'VisibilityState',
] as const

const TARGET_BARREL_HELPERS = [
  'IR_SCHEMA_REF_KINDS',
  'IrSchemaRefKind',
  'STUDIO_SCHEMA_PROJECTION_VERSION',
  'SchemaRevision',
  'classRefKey',
  'isIrClassRef',
  'isIrSchemaRef',
  'isNodePathSchema',
  'isSchemaRevision',
  'parseClassRefKey',
  'parseSchemaRefKey',
  'schemaRefKey',
] as const

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules') return []
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return productionFiles(path)
    return /\.(?:ts|tsx)$/.test(path) && !/\.test\.(?:ts|tsx)$/.test(path) ? [path] : []
  })
}

function parseTypeScript(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  )
}

function resolveTypeScriptModule(file: string, specifier: string): string {
  const target = resolve(dirname(file), specifier)
  const candidate = [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts')].find(
    existsSync,
  )
  if (!candidate) throw new Error(`Cannot resolve ${specifier} from ${file}`)
  return candidate
}

function namedExports(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return []
  seen.add(file)
  const names: string[] = []

  for (const statement of parseTypeScript(file).statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        names.push(...statement.exportClause.elements.map((element) => element.name.text))
      } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        names.push(statement.exportClause.name.text)
      } else if (
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith('.')
      ) {
        names.push(
          ...namedExports(resolveTypeScriptModule(file, statement.moduleSpecifier.text), seen),
        )
      }
      continue
    }
    if (!hasExportModifier(statement)) continue
    if (ts.isVariableStatement(statement)) {
      names.push(
        ...statement.declarationList.declarations.flatMap(({ name }) => bindingNames(name)),
      )
    } else if (
      (ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text)
    }
  }
  return names
}

function moduleSpecifiers(file: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      found.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseTypeScript(file))
  return found
}

function declaredTypes(file: string, candidates: ReadonlySet<string>): string[] {
  const text = readFileSync(file, 'utf8')
  if (![...candidates].some((name) => text.includes(name))) return []
  return parseTypeScript(file).statements.flatMap((statement) => {
    if (
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.isClassDeclaration(statement) &&
      !ts.isEnumDeclaration(statement)
    ) {
      return []
    }
    const name = statement.name?.text
    return name && candidates.has(name) ? [name] : []
  })
}

test('types.ts remains a re-export-only compatibility facade', () => {
  const source = parseTypeScript(join(SHARED_ROOT, 'types.ts'))
  const exports = source.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return []
    }
    return [statement.moduleSpecifier.text]
  })
  expect(exports).toEqual([
    './schema/identity',
    './contracts/schema',
    './contracts/workspace',
    './contracts/agent',
    './contracts/runtime',
  ])
  expect(source.statements.every(ts.isExportDeclaration)).toBe(true)
})

test('types.ts exposes exactly the Studio V1 shared surface', () => {
  const exports = namedExports(join(SHARED_ROOT, 'types.ts'))
  const duplicates = exports.filter((name, index) => exports.indexOf(name) !== index)
  const expected = [...TARGET_BARREL_EXPORTS, ...TARGET_BARREL_HELPERS].sort()

  expect(duplicates).toEqual([])
  expect(exports.sort()).toEqual(expected)
})

test('persisted layout and visibility shapes each have one semantic owner', () => {
  const files = productionFiles(STUDIO_ROOT)
  const names = new Set(['LayoutState', 'VisibilityState'])
  const owners = new Map([...names].map((name) => [name, [] as string[]]))
  for (const file of files) {
    for (const name of declaredTypes(file, names)) {
      owners.get(name)!.push(relative(STUDIO_ROOT, file).replaceAll('\\', '/'))
    }
  }
  expect(Object.fromEntries(owners)).toEqual({
    LayoutState: ['shared/contracts/workspace.ts'],
    VisibilityState: ['shared/contracts/workspace.ts'],
  })
})

test('contract modules follow the documented dependency direction', () => {
  const expectedImports = new Map([
    ['schema/identity.ts', []],
    ['contracts/schema.ts', ['../schema/identity']],
    ['contracts/workspace.ts', ['./schema']],
    ['contracts/agent.ts', ['./workspace']],
    ['contracts/runtime.ts', ['./agent']],
  ])

  for (const [file, expected] of expectedImports) {
    const imports = moduleSpecifiers(join(SHARED_ROOT, file)).filter((specifier) =>
      specifier.startsWith('.'),
    )
    expect(imports).toEqual(expected)
  }
})
