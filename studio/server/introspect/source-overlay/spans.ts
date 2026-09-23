/**
 * Source coordinates and leading documentation for authored schema members.
 */
import { existsSync } from 'node:fs'
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type Project,
  type PropertyAccessExpression,
  type SourceFile,
} from 'ts-morph'

import type { SchemaIR, SourceSpan } from '../../../shared/types'

import {
  calleeName,
  newProject,
  nodeKey,
  objectPropertyValue,
  propertyKey,
  relToRoot,
  resolveObjectLiteral,
  stringLiteralOfProp,
  unwrapExpression,
  valueOfIdentifier,
} from './project'

/**
 * Harvest the leading JSDoc / line-comment block immediately above `node`,
 * stripped of comment markers, collapsed to a single trimmed string.
 */
function leadingDoc(node: Node): string | undefined {
  // Prefer real JSDoc nodes when present (ts-morph exposes them on many decls).
  const anyNode = node as unknown as { getJsDocs?: () => Array<{ getText: () => string }> }
  if (typeof anyNode.getJsDocs === 'function') {
    const docs = anyNode.getJsDocs()
    if (docs.length > 0) {
      const text = docs.map((d) => d.getText()).join('\n')
      const cleaned = cleanComment(text)
      if (cleaned) return cleaned
    }
  }
  // Fall back to raw leading comment ranges (covers `//` line comments too).
  const ranges = node.getLeadingCommentRanges()
  if (ranges.length === 0) return undefined
  const raw = ranges.map((r) => r.getText()).join('\n')
  const cleaned = cleanComment(raw)
  return cleaned || undefined
}

/** Strip `/** *​/`, `//`, leading `*` gutters; collapse to a tidy single line. */
function cleanComment(raw: string): string {
  const lines = raw
    .replace(/\/\*\*?/g, '')
    .replace(/\*\//g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\*\s?/, '')
        .replace(/^\s*\/\/\s?/, '')
        .trim(),
    )
    .filter((l) => l.length > 0)
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

const DECL_HELPERS: Record<string, 'node' | 'edge' | 'function'> = {
  nodeClass: 'node',
  edgeClass: 'edge',
  // `func` is the V1 DSL's standalone-callable helper; `fn` is its older spelling.
  // Without both, a Function gets no span — no file to open, no source doc, and the
  // module tree files it under the domain root instead of the folder declaring it.
  func: 'function',
  fn: 'function',
}

/** `<x>.directed` / `<x>.undirected`: the current edge declaration forms. */
function isEdgeOrientationAccess(expression: Node): expression is PropertyAccessExpression {
  if (!Node.isPropertyAccessExpression(expression)) return false
  const name = expression.getName()
  return name === 'directed' || name === 'undirected'
}

/** Recognize current Class and Function declaration helpers. */
function declarationHelper(call: CallExpression): 'node' | 'edge' | 'function' | undefined {
  const direct = calleeName(call)
  if (direct && direct in DECL_HELPERS) return DECL_HELPERS[direct]
  const expression = call.getExpression()
  if (isEdgeOrientationAccess(expression) && expression.getExpression().getText() === 'edgeClass') {
    return 'edge'
  }
  return undefined
}

/**
 * A schema member's true NAME + section, resolved from the `defineSchema` map.
 * Declaration helpers carry no name: the `defineSchema` key is authoritative.
 */
interface MemberName {
  schemaName: string
  section: 'class' | 'function' | 'policy' | 'view'
  value: Node
}

interface MemberNameMap {
  /** Exact declaration initializer, robust to imported/local aliases. */
  byValue: Map<string, MemberName>
  /** Fallback when a symbol cannot be resolved. */
  byIdentifier: Map<string, MemberName>
}

/** Stable source coordinate for the value behind a local/imported alias. */
function memberValue(node: Node, seen = new Set<string>()): Node | undefined {
  const value = unwrapExpression(node)
  const key = nodeKey(value)
  if (seen.has(key)) return undefined
  seen.add(key)
  if (Node.isIdentifier(value)) {
    const resolved = valueOfIdentifier(value)
    if (resolved) return memberValue(resolved, seen)
  }
  return value
}

function memberValueKey(node: Node): string | undefined {
  const value = memberValue(node)
  return value ? nodeKey(value) : undefined
}

/** Map each registered member VARIABLE (as referenced in `defineSchema`) to its
 *  schema name + section, from the domain's own schema files — never node_modules
 *  (a dependency's `defineSchema` is not this domain's). */
function buildMemberNameMap(files: SourceFile[]): MemberNameMap {
  const map: MemberNameMap = {
    byValue: new Map<string, MemberName>(),
    byIdentifier: new Map<string, MemberName>(),
  }
  for (const sf of files) {
    if (sf.getFilePath().includes('/node_modules/')) continue
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (calleeName(call) !== 'defineSchema') continue
      const input = call.getArguments()[1]
      const cfg = input ? resolveObjectLiteral(input) : undefined
      if (!cfg) continue
      collectSchemaSection(map, cfg, 'classes', 'class')
      collectSchemaSection(map, cfg, 'functions', 'function')
      collectSchemaSection(map, cfg, 'policies', 'policy')
      collectSchemaSection(map, cfg, 'views', 'view')
    }
  }
  return map
}

/** Record `variable → { schemaName, section }` for one `defineSchema` section,
 *  handling both `Key: alias` and shorthand `Key`. */
function collectSchemaSection(
  map: MemberNameMap,
  cfg: ObjectLiteralExpression,
  prop: 'classes' | 'functions' | 'policies' | 'views',
  section: MemberName['section'],
): void {
  const obj = getObjectProp(cfg, prop)
  if (!obj) return
  for (const p of obj.getProperties()) {
    const schemaName = propertyKey(p)
    const declaredValue = objectPropertyValue(p)
    if (!schemaName || !declaredValue) continue
    const value = memberValue(declaredValue)
    if (!value) continue
    const member = { schemaName, section, value } satisfies MemberName
    // `value` is already fully resolved, so its own coordinate is its value key.
    map.byValue.set(nodeKey(value), member)
    const unwrapped = unwrapExpression(declaredValue)
    if (Node.isIdentifier(unwrapped)) map.byIdentifier.set(unwrapped.getText(), member)
  }
}

/**
 * The anchor namespace for a declared member. The Class section plus helper/IR
 * kind distinguishes Node and Edge Classes.
 */
function resolveMemberKind(
  ir: SchemaIR | null,
  name: string,
  section: MemberName['section'] | undefined,
  helperKind: 'node' | 'edge' | 'function',
): 'class' | 'edge' | 'function' {
  if (section === 'function' || helperKind === 'function') return 'function'
  const isEdge = helperKind === 'edge' || ir?.classes?.[name]?.type === 'edge'
  return isEdge ? 'edge' : 'class'
}

export function buildSourceSpans(args: {
  ir: SchemaIR | null
  domainRoot: string
  schemaDir: string
  /** Shared with the handler reading — see buildOverlay. */
  project?: Project
}): Record<string, SourceSpan> {
  const { ir, domainRoot, schemaDir } = args
  if (!schemaDir || !existsSync(schemaDir)) return {}

  const project = args.project ?? newProject()
  const dir = schemaDir.replace(/\/$/u, '')
  try {
    project.addSourceFilesAtPaths(`${dir}/**/*.ts`)
  } catch {
    return {}
  }

  const spans: Record<string, SourceSpan> = {}

  // Select by path, not by what the add call returned: on a shared project the
  // handler reading has already added most of these, and they come back as
  // "nothing added" rather than as this reading's fileset.
  const sourceFiles = project
    .getSourceFiles()
    .filter((f) => f.getFilePath() === dir || f.getFilePath().startsWith(`${dir}/`))
  // The Domain's `defineSchema` map is authoritative for each member's name.
  const memberNames = buildMemberNameMap(sourceFiles)
  for (const { schemaName, section, value } of memberNames.byValue.values()) {
    if (section !== 'policy' && section !== 'view') continue
    const statement = value.getFirstAncestorByKind(SyntaxKind.VariableStatement)
    spans[`${section}.${schemaName}`] = makeSpan(
      relToRoot(domainRoot, value.getSourceFile().getFilePath()),
      value,
      statement ?? value,
    )
  }

  for (const sf of sourceFiles) {
    const fileRel = relToRoot(domainRoot, sf.getFilePath())

    for (const v of sf.getVariableDeclarations()) {
      if (!v.isExported()) continue
      const init = v.getInitializer()
      if (!init || !Node.isCallExpression(init)) continue
      const helperKind = declarationHelper(init)
      if (!helperKind) continue
      const valueKey = memberValueKey(init)
      const member =
        (valueKey ? memberNames.byValue.get(valueKey) : undefined) ??
        memberNames.byIdentifier.get(v.getName())
      const name = member?.schemaName ?? v.getName()
      const ns = resolveMemberKind(ir, name, member?.section, helperKind)

      const stmt = v.getVariableStatement() ?? v
      spans[`${ns}.${name}`] = makeSpan(fileRel, stmt, v)

      // The single object-literal argument: nodeClass({ properties, methods })
      // and current edgeClass.directed({ source, target, properties }).
      const cfgArg = init.getArguments()[0]
      if (ns !== 'function' && cfgArg && Node.isObjectLiteralExpression(cfgArg)) {
        collectPropsAndMethods(spans, ns, name, cfgArg, fileRel)
      }

      // Edges: endpoints are the first two args; props live in the third.
      if (ns === 'edge') {
        collectEdge(spans, name, init, fileRel)
      }
    }
  }

  return spans
}

/** Build a SourceSpan, harvesting leading doc from the declaration `docNode`. */
function makeSpan(fileRel: string, spanNode: Node, docNode: Node): SourceSpan {
  const span: SourceSpan = {
    file: fileRel,
    startLine: spanNode.getStartLineNumber(),
    endLine: spanNode.getEndLineNumber(),
  }
  const doc = leadingDoc(docNode) ?? (docNode === spanNode ? undefined : leadingDoc(spanNode))
  if (doc) span.doc = doc
  return span
}

/** Record `<ns>.<Name>.property.<p>` and `.method.<m>` from a config object. */
function collectPropsAndMethods(
  spans: Record<string, SourceSpan>,
  ns: string,
  name: string,
  cfg: ObjectLiteralExpression,
  fileRel: string,
): void {
  const propsObj = getObjectProp(cfg, 'properties') ?? getObjectProp(cfg, 'props')
  if (propsObj) collectMemberSpans(spans, `${ns}.${name}.property`, propsObj, fileRel)
  const methodsObj = getObjectProp(cfg, 'methods')
  if (methodsObj) collectMemberSpans(spans, `${ns}.${name}.method`, methodsObj, fileRel)
}

/** Record `<prefix>.<key>` for every named property of `obj`. */
function collectMemberSpans(
  spans: Record<string, SourceSpan>,
  prefix: string,
  obj: ObjectLiteralExpression,
  fileRel: string,
): void {
  for (const p of obj.getProperties()) {
    const key = propertyKey(p)
    if (key) spans[`${prefix}.${key}`] = makeSpan(fileRel, p, p)
  }
}

/**
 * Record edge endpoint spans from current directed/undirected forms. Their
 * property spans are already recorded by `collectPropsAndMethods`.
 */
function collectEdge(
  spans: Record<string, SourceSpan>,
  name: string,
  init: CallExpression,
  fileRel: string,
): void {
  const argsList = init.getArguments()
  const config = argsList[0]
  if (
    isEdgeOrientationAccess(init.getExpression()) &&
    config &&
    Node.isObjectLiteralExpression(config)
  ) {
    for (const endpointName of ['source', 'target'] as const) {
      const ep = getObjectProp(config, endpointName)
      if (!ep) continue
      const role = stringLiteralOfProp(ep, 'as') ?? stringLiteralOfProp(ep, 'role')
      if (role) spans[`edge.${name}.endpoint.${role}`] = makeSpan(fileRel, ep, ep)
    }
    return
  }

  for (let i = 0; i < Math.min(2, argsList.length); i++) {
    const ep = argsList[i]
    if (!Node.isObjectLiteralExpression(ep)) continue
    const role = stringLiteralOfProp(ep, 'as')
    if (!role) continue
    spans[`edge.${name}.endpoint.${role}`] = makeSpan(fileRel, ep, ep)
  }
}

/** The object-literal value of a named property, if it is itself an object. */
function getObjectProp(
  obj: ObjectLiteralExpression,
  name: string,
): ObjectLiteralExpression | undefined {
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  let value: Node | undefined
  if (Node.isPropertyAssignment(prop)) value = prop.getInitializer()
  else if (Node.isShorthandPropertyAssignment(prop)) value = prop.getNameNode()
  return value ? resolveObjectLiteral(value) : undefined
}
