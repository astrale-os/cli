/**
 * Source coordinates and leading documentation for authored schema members.
 */
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph'

import type { SchemaIR, SourceSpan } from '../../../shared/types'

import {
  calleeName,
  newProject,
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
  fn: 'function',
}

/** Recognize current Class and Function declaration helpers. */
function declarationHelper(call: CallExpression): 'node' | 'edge' | 'function' | undefined {
  const direct = calleeName(call)
  if (direct && direct in DECL_HELPERS) return DECL_HELPERS[direct]
  const expression = call.getExpression()
  if (
    Node.isPropertyAccessExpression(expression) &&
    (expression.getName() === 'directed' || expression.getName() === 'undirected') &&
    expression.getExpression().getText() === 'edgeClass'
  ) {
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
  section: 'class' | 'function'
}

interface MemberNameMap {
  /** Exact declaration initializer, robust to imported/local aliases. */
  byValue: Map<string, MemberName>
  /** Fallback when a symbol cannot be resolved. */
  byIdentifier: Map<string, MemberName>
}

/** Stable source coordinate for the value behind a local/imported alias. */
function memberValueKey(node: Node, seen = new Set<string>()): string | undefined {
  const value = unwrapExpression(node)
  const key = `${value.getSourceFile().getFilePath()}:${value.getStart()}`
  if (seen.has(key)) return undefined
  seen.add(key)
  if (Node.isIdentifier(value)) {
    const resolved = valueOfIdentifier(value)
    if (resolved) return memberValueKey(resolved, seen)
  }
  return key
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
    }
  }
  return map
}

/** Record `variable → { schemaName, section }` for one `defineSchema` section,
 *  handling both `Key: alias` and shorthand `Key`. */
function collectSchemaSection(
  map: MemberNameMap,
  cfg: Node,
  prop: 'classes' | 'functions',
  section: 'class' | 'function',
): void {
  const obj = getObjectProp(cfg, prop)
  if (!obj) return
  for (const p of obj.getProperties()) {
    const schemaName = propertyKey(p)
    const memberValue = objectPropertyValue(p)
    if (!schemaName || !memberValue) continue
    const member = { schemaName, section } satisfies MemberName
    const valueKey = memberValueKey(memberValue)
    if (valueKey) map.byValue.set(valueKey, member)
    const unwrapped = unwrapExpression(memberValue)
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
  section: 'class' | 'function' | undefined,
  helperKind: 'node' | 'edge' | 'function',
): 'class' | 'edge' | 'function' {
  if (section === 'function' || helperKind === 'function') return 'function'
  const isEdge = helperKind === 'edge' || ir?.classes?.[name]?.type === 'edge'
  if (section === 'class') return isEdge ? 'edge' : 'class'
  return isEdge ? 'edge' : 'class'
}

export function buildSourceSpans(args: {
  ir: SchemaIR | null
  schemaDir: string
}): Record<string, SourceSpan> {
  const { ir, schemaDir } = args
  if (!schemaDir || !existsSync(schemaDir)) return {}

  // The domain root is the parent of the schema dir (spans are relative to it).
  const domainRoot = dirname(schemaDir.replace(/\/$/, ''))

  const project = newProject()
  let files: string[] = []
  try {
    const added = project.addSourceFilesAtPaths(`${schemaDir.replace(/\/$/, '')}/**/*.ts`)
    files = added.map((f) => f.getFilePath())
  } catch {
    return {}
  }

  const spans: Record<string, SourceSpan> = {}

  const sourceFiles = files.map((f) => project.getSourceFile(f)).filter((f): f is SourceFile => !!f)
  // The Domain's `defineSchema` map is authoritative for each member's name.
  const memberNames = buildMemberNameMap(sourceFiles)

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
      spans[`${ns}.${name}`] = makeSpan(domainRoot, fileRel, stmt, v)

      // The single object-literal argument: nodeClass({ properties, methods })
      // and current edgeClass.directed({ source, target, properties }).
      const cfgArg = init.getArguments()[0]
      if (ns !== 'function' && cfgArg && Node.isObjectLiteralExpression(cfgArg)) {
        collectPropsAndMethods(spans, ns, name, cfgArg, domainRoot, fileRel)
      }

      // Edges: endpoints are the first two args; props live in the third.
      if (ns === 'edge') {
        collectEdge(spans, name, init, domainRoot, fileRel)
      }
    }
  }

  return spans
}

/** Build a SourceSpan, harvesting leading doc from the declaration `docNode`. */
function makeSpan(domainRoot: string, fileRel: string, spanNode: Node, docNode: Node): SourceSpan {
  const span: SourceSpan = {
    file: fileRel,
    startLine: spanNode.getStartLineNumber(),
    endLine: spanNode.getEndLineNumber(),
  }
  const doc = leadingDoc(docNode) ?? leadingDoc(spanNode)
  if (doc) span.doc = doc
  return span
}

/** Record `<ns>.<Name>.property.<p>` and `.method.<m>` from a config object. */
function collectPropsAndMethods(
  spans: Record<string, SourceSpan>,
  ns: string,
  name: string,
  cfg: Node,
  domainRoot: string,
  fileRel: string,
): void {
  if (!Node.isObjectLiteralExpression(cfg)) return
  const propsObj = getObjectProp(cfg, 'properties') ?? getObjectProp(cfg, 'props')
  if (propsObj) {
    for (const p of propsObj.getProperties()) {
      const pName = propertyKey(p)
      if (!pName) continue
      spans[`${ns}.${name}.property.${pName}`] = makeSpan(domainRoot, fileRel, p, p)
    }
  }
  const methodsObj = getObjectProp(cfg, 'methods')
  if (methodsObj) {
    for (const m of methodsObj.getProperties()) {
      const mName = propertyKey(m)
      if (!mName) continue
      spans[`${ns}.${name}.method.${mName}`] = makeSpan(domainRoot, fileRel, m, m)
    }
  }
}

/** Record edge endpoint and property spans from current directed/undirected forms. */
function collectEdge(
  spans: Record<string, SourceSpan>,
  name: string,
  init: CallExpression,
  domainRoot: string,
  fileRel: string,
): void {
  const argsList = init.getArguments()
  const expression = init.getExpression()
  const currentObjectForm =
    Node.isPropertyAccessExpression(expression) &&
    (expression.getName() === 'directed' || expression.getName() === 'undirected') &&
    argsList[0] &&
    Node.isObjectLiteralExpression(argsList[0])

  if (currentObjectForm) {
    const config = argsList[0]
    if (Node.isObjectLiteralExpression(config)) {
      for (const endpointName of ['source', 'target'] as const) {
        const ep = getObjectProp(config, endpointName)
        if (!ep) continue
        const role = stringLiteralOfProp(ep, 'as') ?? stringLiteralOfProp(ep, 'role')
        if (role) spans[`edge.${name}.endpoint.${role}`] = makeSpan(domainRoot, fileRel, ep, ep)
      }
      const properties = getObjectProp(config, 'properties') ?? getObjectProp(config, 'props')
      if (properties) {
        for (const p of properties.getProperties()) {
          const pName = propertyKey(p)
          if (!pName) continue
          spans[`edge.${name}.property.${pName}`] = makeSpan(domainRoot, fileRel, p, p)
        }
      }
    }
    return
  }

  for (let i = 0; i < Math.min(2, argsList.length); i++) {
    const ep = argsList[i]
    if (!Node.isObjectLiteralExpression(ep)) continue
    const role = stringLiteralOfProp(ep, 'as')
    if (!role) continue
    spans[`edge.${name}.endpoint.${role}`] = makeSpan(domainRoot, fileRel, ep, ep)
  }
}

/** The object-literal value of a named property, if it is itself an object. */
function getObjectProp(
  obj: Node,
  name: string,
): import('ts-morph').ObjectLiteralExpression | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  let value: Node | undefined
  if (Node.isPropertyAssignment(prop)) value = prop.getInitializer()
  else if (Node.isShorthandPropertyAssignment(prop)) value = prop.getNameNode()
  return value ? resolveObjectLiteral(value) : undefined
}
