/**
 * A definition's input as its declared type says: the fields of the type `build`'s first
 * parameter declares, or the one value it is, and what each one is from its type alone. Types
 * declared in the same file or exported by a module of the Domain the reading resolves are
 * followed; any other type leaves the input unread, with the reason, instead of a guess.
 */
import {
  Node,
  SyntaxKind,
  type EnumDeclaration,
  type InterfaceDeclaration,
  type MappedTypeNode,
  type Project,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeLiteralNode,
  type TypeNode,
} from 'ts-morph'

import type {
  DefinitionInput,
  DefinitionInputField,
  DefinitionInputKind,
} from '../../../shared/contracts/schema'
import type { Callable } from './flow'

import { leadingDoc, relToRoot, resolveModuleFile, tryAddFile } from './project'

/** A field as the input declares it, before the reading tells what `build` does with it. */
export type DeclaredField = Omit<DefinitionInputField, 'read' | 'uses'>

export interface DeclaredInput {
  form: DefinitionInput['form']
  fields: DeclaredField[]
  /** where and why the reading cannot resolve the type, when it is `unread` */
  gap?: { at: Node; reason: string }
  /**
   * The member names a part of the input holds, `path` read from the input (each item of a
   * list in place of the list): what spreading that part writes. Undefined when the reading
   * cannot tell.
   */
  membersAt(path: readonly string[]): readonly string[] | undefined
}

/** How far one type is followed through names, so two types naming each other end. */
const MAX_TYPE_DEPTH = 16

const SDK = '@astrale-os/sdk'
/** SDK types whose value names one Node. */
const NODE_TYPES = new Set(['NodeId', 'NodePath'])
/** Built-in generics whose argument is an item type. */
const COLLECTIONS = new Set(['Array', 'ReadonlyArray', 'Set', 'ReadonlySet'])

type Literal = string | number | boolean

interface Kind {
  readonly kind: DefinitionInputKind
  readonly literals?: readonly Literal[]
}

/** One member of an object type, as a field of the input. */
interface Member {
  readonly name: string
  readonly optional: boolean
  /** each type a branch declares it with: one, unless a union of objects declares it again */
  readonly types: readonly TypeNode[]
  readonly at: Node
}

type Shape =
  | { readonly form: 'fields'; readonly members: readonly Member[] }
  | { readonly form: 'value' }
  | { readonly form: 'none' }
  | { readonly form: 'unread'; readonly at: Node; readonly reason: string }

type Declaration = InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration

/** What a type name stands for: a declaration the reading follows, an SDK type, or why neither. */
type Named =
  | { readonly declaration: Declaration }
  | { readonly sdk: string }
  | { readonly reason: string }

function isSdk(module: string): boolean {
  return module === SDK || module.startsWith(`${SDK}/`)
}

function within(domainRoot: string, file: string): boolean {
  const relative = relToRoot(domainRoot, file)
  return relative !== '' && !relative.startsWith('../') && relative !== '..'
}

function unwrapType(type: TypeNode): TypeNode {
  let current: TypeNode = type
  while (Node.isParenthesizedTypeNode(current)) current = current.getTypeNode()
  return current
}

function isAbsent(type: TypeNode): boolean {
  const value = unwrapType(type)
  return (
    value.getKind() === SyntaxKind.UndefinedKeyword ||
    (Node.isLiteralTypeNode(value) && value.getLiteral().getKind() === SyntaxKind.NullKeyword)
  )
}

/** The type parameter of a declaration around `node` named `name`, when one is. */
function isTypeParameter(node: Node, name: string): boolean {
  return node.getAncestors().some((ancestor) => {
    const declared = ancestor as { getTypeParameters?: () => Array<{ getName(): string }> }
    return declared.getTypeParameters?.().some((parameter) => parameter.getName() === name) ?? false
  })
}

/** A declaration a file holds at its top level under `name`, exported or not. */
function declaredIn(file: SourceFile, name: string): Declaration | undefined {
  return file.getInterface(name) ?? file.getTypeAlias(name) ?? file.getEnum(name)
}

/** What a name stands for in the file `at` is written in. */
function namedIn(
  file: SourceFile,
  name: string,
  at: Node,
  domainRoot: string,
  seen: Set<string>,
): Named {
  const declaration = declaredIn(file, name)
  if (declaration) return { declaration }
  for (const declared of file.getImportDeclarations()) {
    const specifier = declared
      .getNamedImports()
      .find((named) => (named.getAliasNode()?.getText() ?? named.getName()) === name)
    if (!specifier) continue
    const module = declared.getModuleSpecifierValue()
    if (isSdk(module)) return { sdk: specifier.getName() }
    const target = resolveModuleFile(file, module)
    if (!target || !within(domainRoot, target))
      return { reason: `imported from \`${module}\`, which the reading does not follow` }
    return exported(at.getProject(), target, specifier.getName(), domainRoot, seen)
  }
  return { reason: 'which the reading cannot find' }
}

/** The declaration a Domain module exports under `name`, through its re-exports. */
function exported(
  project: Project,
  path: string,
  name: string,
  domainRoot: string,
  seen: Set<string>,
): Named {
  const key = `${path}:${name}`
  const file = !seen.has(key) && tryAddFile(project, path)
  if (!file) return { reason: 'which the reading cannot find' }
  seen.add(key)
  const local = declaredIn(file, name)
  if (local?.isExported()) return { declaration: local }
  for (const declaration of file.getExportDeclarations()) {
    const module = declaration.getModuleSpecifierValue()
    const target = module === undefined ? undefined : resolveModuleFile(file, module)
    const named = declaration.getNamedExports()
    if (named.length === 0) {
      if (!target || !within(domainRoot, target)) continue
      const found = exported(project, target, name, domainRoot, seen)
      if ('declaration' in found) return found
      continue
    }
    const specifier = named.find(
      (candidate) => (candidate.getAliasNode()?.getText() ?? candidate.getName()) === name,
    )
    if (!specifier) continue
    if (module === undefined) return namedIn(file, specifier.getName(), specifier, domainRoot, seen)
    if (isSdk(module)) return { sdk: specifier.getName() }
    if (!target || !within(domainRoot, target))
      return { reason: `imported from \`${module}\`, which the reading does not follow` }
    return exported(project, target, specifier.getName(), domainRoot, seen)
  }
  return { reason: 'which the reading cannot find' }
}

/** What a type reference's name stands for. */
function named(reference: Node, domainRoot: string): Named {
  const name = reference.getText()
  if (isTypeParameter(reference, name))
    return { reason: 'a generic type the reading cannot resolve' }
  return namedIn(reference.getSourceFile(), name, reference, domainRoot, new Set())
}

/**
 * A type on one line, as written: comments left out, an object type's members joined by `;`,
 * and the formatter's line breaks folded.
 */
export function typeText(type: Node): string {
  if (Node.isTypeLiteral(type)) {
    const members = type.getMembers().map(typeText)
    return members.length === 0 ? '{}' : `{ ${members.join('; ')} }`
  }
  if (Node.isPropertySignature(type)) {
    const written = type.getTypeNode()
    return `${type.isReadonly() ? 'readonly ' : ''}${type.getName()}${type.hasQuestionToken() ? '?' : ''}${written ? `: ${typeText(written)}` : ''}`
  }
  const start = type.getStart()
  const text = type.getText()
  const spans: Array<{ pos: number; end: number; text: string }> = []
  type.forEachDescendant((child, traversal) => {
    if (Node.isTypeLiteral(child)) {
      spans.push({ pos: child.getStart(), end: child.getEnd(), text: typeText(child) })
      return traversal.skip()
    }
    for (const range of [...child.getLeadingCommentRanges(), ...child.getTrailingCommentRanges()])
      if (range.getPos() >= start && range.getEnd() <= type.getEnd())
        spans.push({ pos: range.getPos(), end: range.getEnd(), text: ' ' })
    return undefined
  })
  let written = ''
  let at = start
  for (const span of spans.sort((left, right) => left.pos - right.pos)) {
    if (span.pos < at) continue
    written += text.slice(at - start, span.pos - start) + span.text
    at = span.end
  }
  written += text.slice(at - start)
  return written
    .replace(/\s+/g, ' ')
    .replace(/([<([]) /g, '$1')
    .replace(/ ([>)\]])/g, '$1')
    .replace(/^\| /, '')
    .trim()
}

/** The literal a literal type writes, when it writes one. */
function literalOf(type: TypeNode): Literal | undefined {
  if (!Node.isLiteralTypeNode(type)) return undefined
  const literal = type.getLiteral()
  if (Node.isStringLiteral(literal) || Node.isNoSubstitutionTemplateLiteral(literal))
    return literal.getLiteralText()
  if (Node.isNumericLiteral(literal)) return literal.getLiteralValue()
  if (Node.isPrefixUnaryExpression(literal)) {
    const operand = literal.getOperand()
    if (Node.isNumericLiteral(operand) && literal.getOperatorToken() === SyntaxKind.MinusToken)
      return -operand.getLiteralValue()
    return undefined
  }
  if (literal.getKind() === SyntaxKind.TrueKeyword) return true
  if (literal.getKind() === SyntaxKind.FalseKeyword) return false
  return undefined
}

const UNKNOWN: Kind = { kind: 'unknown' }

/** One kind for the kinds the branches of a union give: `unknown` when they differ. */
function joined(kinds: readonly Kind[]): Kind {
  if (kinds.length === 0) return UNKNOWN
  const kind = kinds[0]!.kind
  if (kind === 'unknown' || kinds.some((other) => other.kind !== kind)) return UNKNOWN
  if ((kind !== 'value' && kind !== 'values') || kinds.some((other) => !other.literals))
    return { kind }
  return { kind, literals: [...new Set(kinds.flatMap((other) => other.literals!))] }
}

/** Several of what one item is. */
function itemsOf(item: Kind): Kind {
  if (item.kind === 'node') return { kind: 'nodes' }
  if (item.kind === 'value')
    return item.literals ? { kind: 'values', literals: item.literals } : { kind: 'values' }
  return UNKNOWN
}

/** What a type declares, from the type alone: a Node id, several, a plain value, several, or unknown. */
function kindOf(type: TypeNode, domainRoot: string, depth: number): Kind {
  if (depth > MAX_TYPE_DEPTH) return UNKNOWN
  const value = unwrapType(type)
  const next = (inner: TypeNode) => kindOf(inner, domainRoot, depth + 1)
  switch (value.getKind()) {
    case SyntaxKind.StringKeyword:
    case SyntaxKind.NumberKeyword:
    case SyntaxKind.BooleanKeyword:
    case SyntaxKind.BigIntKeyword:
    case SyntaxKind.TemplateLiteralType:
      return { kind: 'value' }
  }
  const literal = literalOf(value)
  if (literal !== undefined) return { kind: 'value', literals: [literal] }
  if (Node.isUnionTypeNode(value)) {
    return joined(
      value
        .getTypeNodes()
        .filter((branch) => !isAbsent(branch))
        .map(next),
    )
  }
  if (Node.isArrayTypeNode(value)) return itemsOf(next(value.getElementTypeNode()))
  if (Node.isTypeOperatorTypeNode(value) && value.getOperator() === SyntaxKind.ReadonlyKeyword)
    return next(value.getTypeNode())
  if (!Node.isTypeReference(value)) return UNKNOWN
  const name = value.getTypeName()
  if (!Node.isIdentifier(name)) return UNKNOWN
  const args = value.getTypeArguments()
  const resolved = named(name, domainRoot)
  if ('declaration' in resolved) {
    const declaration = resolved.declaration
    if (Node.isEnumDeclaration(declaration)) return { kind: 'value' }
    if (Node.isInterfaceDeclaration(declaration)) return UNKNOWN
    if (declaration.getTypeParameters().length > 0) return UNKNOWN
    return next(declaration.getTypeNodeOrThrow())
  }
  if ('sdk' in resolved) return NODE_TYPES.has(resolved.sdk) ? { kind: 'node' } : UNKNOWN
  // a built-in generic, by its name, when nothing the file declares or imports shadows it
  const [first, second] = args
  if (COLLECTIONS.has(name.getText()) && first) return itemsOf(next(first))
  if ((name.getText() === 'Readonly' || name.getText() === 'NonNullable') && first)
    return next(first)
  if ((name.getText() === 'Extract' || name.getText() === 'Exclude') && first && second) {
    const from = next(first)
    const taken = next(second)
    if (!from.literals || !taken.literals) return from.literals ? { kind: from.kind } : from
    const kept = from.literals.filter(
      (candidate) => taken.literals!.includes(candidate) === (name.getText() === 'Extract'),
    )
    return { kind: from.kind, literals: kept }
  }
  return UNKNOWN
}

/** The members an object type declares, in declaration order; why not, when it declares none the reading can list. */
function shapeOf(type: TypeNode, domainRoot: string, depth: number): Shape {
  const value = unwrapType(type)
  const unread = (reason: string): Shape => ({
    form: 'unread',
    at: value,
    reason: `takes its input as ${quoted(value)}, ${reason}`,
  })
  if (depth > MAX_TYPE_DEPTH) return unread('nested deeper than the reading follows')
  const next = (inner: TypeNode) => shapeOf(inner, domainRoot, depth + 1)
  switch (value.getKind()) {
    case SyntaxKind.UndefinedKeyword:
    case SyntaxKind.VoidKeyword:
    case SyntaxKind.NeverKeyword:
      return { form: 'none' }
    case SyntaxKind.StringKeyword:
    case SyntaxKind.NumberKeyword:
    case SyntaxKind.BooleanKeyword:
    case SyntaxKind.BigIntKeyword:
    case SyntaxKind.TemplateLiteralType:
    case SyntaxKind.ArrayType:
    case SyntaxKind.TupleType:
      return { form: 'value' }
  }
  if (isAbsent(value)) return { form: 'none' }
  if (literalOf(value) !== undefined) return { form: 'value' }
  if (Node.isTypeOperatorTypeNode(value))
    return value.getOperator() === SyntaxKind.ReadonlyKeyword
      ? next(value.getTypeNode())
      : unread('which the reading cannot resolve')
  if (Node.isTypeLiteral(value)) {
    const members = objectMembers(value)
    return members ? { form: 'fields', members } : unread('whose fields the reading cannot list')
  }
  if (Node.isMappedTypeNode(value)) {
    const members = mappedMembers(value, domainRoot, depth)
    return members ? { form: 'fields', members } : unread('whose fields the reading cannot list')
  }
  if (Node.isUnionTypeNode(value)) {
    const branches = value
      .getTypeNodes()
      .filter((branch) => !isAbsent(branch))
      .map(next)
    if (branches.length === 0) return { form: 'none' }
    const failed = branches.find((branch) => branch.form === 'unread')
    if (failed) return failed
    if (branches.every((branch) => branch.form === 'value')) return { form: 'value' }
    if (!branches.every((branch) => branch.form === 'fields'))
      return unread('a union the reading cannot read as one object or one value')
    return { form: 'fields', members: either(branches.map((branch) => branch.members)) }
  }
  if (Node.isIntersectionTypeNode(value)) {
    const parts = value.getTypeNodes().map(next)
    const failed = parts.find((part) => part.form === 'unread')
    if (failed) return failed
    if (!parts.every((part) => part.form === 'fields'))
      return unread('an intersection the reading cannot read as one object')
    return { form: 'fields', members: merged(parts.flatMap((part) => part.members)) }
  }
  if (!Node.isTypeReference(value)) return unread('which the reading cannot resolve')
  const name = value.getTypeName()
  if (!Node.isIdentifier(name)) return unread('which the reading does not follow')
  return referenceShape(name, value.getTypeArguments(), domainRoot, depth, unread)
}

/**
 * What a named type holds, handed `args`: a declaration the reading follows, an SDK Node id, or a
 * built-in generic that keeps or narrows an object's members.
 */
function referenceShape(
  name: Node,
  args: readonly TypeNode[],
  domainRoot: string,
  depth: number,
  unread: (reason: string) => Shape,
): Shape {
  const next = (inner: TypeNode) => shapeOf(inner, domainRoot, depth + 1)
  const resolved = named(name, domainRoot)
  if ('declaration' in resolved) {
    const declaration = resolved.declaration
    if (Node.isEnumDeclaration(declaration)) return { form: 'value' }
    if (declaration.getTypeParameters().length > 0 || args.length > 0)
      return unread('a generic type the reading cannot resolve')
    if (Node.isTypeAliasDeclaration(declaration)) return next(declaration.getTypeNodeOrThrow())
    const members: Member[] = []
    for (const extended of declaration.getExtends()) {
      const expression = extended.getExpression()
      if (!Node.isIdentifier(expression))
        return unread(`which extends ${quoted(extended)}, a type the reading does not follow`)
      const inherited = referenceShape(
        expression,
        extended.getTypeArguments(),
        domainRoot,
        depth + 1,
        (reason) => unread(`which extends ${quoted(extended)}, ${reason}`),
      )
      if (inherited.form === 'unread') return inherited
      if (inherited.form !== 'fields')
        return unread(`which extends ${quoted(extended)}, a type that declares no fields`)
      members.push(...inherited.members)
    }
    const own = objectMembers(declaration)
    if (!own) return unread('whose fields the reading cannot list')
    return { form: 'fields', members: overridden([...members, ...own]) }
  }
  if ('sdk' in resolved) {
    return NODE_TYPES.has(resolved.sdk)
      ? { form: 'value' }
      : unread(`imported from \`${SDK}\`, which the reading does not follow`)
  }
  // a built-in generic, by its name, when nothing the file declares or imports shadows it
  const [first, second] = args
  const builtin = name.getText()
  if (COLLECTIONS.has(builtin)) return { form: 'value' }
  if ((builtin === 'Readonly' || builtin === 'NonNullable' || builtin === 'Required') && first) {
    const inner = next(first)
    return builtin === 'Required' && inner.form === 'fields'
      ? { form: 'fields', members: inner.members.map((member) => ({ ...member, optional: false })) }
      : inner
  }
  if (builtin === 'Partial' && first) {
    const inner = next(first)
    return inner.form === 'fields'
      ? { form: 'fields', members: inner.members.map((member) => ({ ...member, optional: true })) }
      : inner
  }
  if ((builtin === 'Pick' || builtin === 'Omit') && first && second) {
    const inner = next(first)
    if (inner.form === 'unread') return inner
    const keys = kindOf(second, domainRoot, depth + 1).literals
    if (inner.form !== 'fields' || !keys) return unread('which the reading cannot resolve')
    return {
      form: 'fields',
      members: inner.members.filter(
        (member) => keys.includes(member.name) === (builtin === 'Pick'),
      ),
    }
  }
  return unread(args.length > 0 ? 'a generic type the reading cannot resolve' : resolved.reason)
}

/** The members an object type or an interface declares itself; undefined when it declares them by an index or a call signature. */
function objectMembers(declaration: TypeLiteralNode | InterfaceDeclaration): Member[] | undefined {
  if (
    declaration.getIndexSignatures().length > 0 ||
    declaration.getCallSignatures().length > 0 ||
    declaration.getConstructSignatures().length > 0
  )
    return undefined
  return declaration.getProperties().map((property) => {
    const type = property.getTypeNode()
    return {
      name: property.getName(),
      optional: property.hasQuestionToken(),
      types: type ? [type] : [],
      at: property,
    }
  })
}

/**
 * The members a mapped type declares over a union of string literals (`{ [K in 'a' | 'b']: T }`),
 * each of type `T` unless `T` names the key; undefined over any other keys or with an `as` clause.
 */
function mappedMembers(
  mapped: MappedTypeNode,
  domainRoot: string,
  depth: number,
): Member[] | undefined {
  const parameter = mapped.getTypeParameter()
  const constraint = parameter.getConstraint()
  const keys = constraint && kindOf(constraint, domainRoot, depth + 1).literals
  if (!keys || mapped.getNameTypeNode() || keys.some((key) => typeof key !== 'string'))
    return undefined
  const type = mapped.getTypeNode()
  const key = parameter.getName()
  const names = (reference: Node) =>
    Node.isTypeReference(reference) && reference.getTypeName().getText() === key
  const each = type && !names(type) && !type.getDescendants().some(names) ? [type] : []
  const optional = mapped.getQuestionToken()?.getKind()
  return keys.map((name) => ({
    name: String(name),
    optional: optional === SyntaxKind.QuestionToken || optional === SyntaxKind.PlusToken,
    types: each,
    at: mapped,
  }))
}

/** Members declared again later replace the earlier declaration, keeping its position. */
function overridden(members: readonly Member[]): Member[] {
  const byName = new Map<string, Member>()
  for (const member of members) byName.set(member.name, member)
  return [...byName.values()]
}

/** The members of an intersection: each declared once, with every type it is declared with. */
function merged(members: readonly Member[]): Member[] {
  const byName = new Map<string, Member>()
  for (const member of members) {
    const known = byName.get(member.name)
    byName.set(
      member.name,
      known
        ? {
            ...known,
            optional: known.optional && member.optional,
            types: [...known.types, ...member.types],
          }
        : member,
    )
  }
  return [...byName.values()]
}

/** The members a union of objects declares: optional where a branch leaves one out. */
function either(branches: ReadonlyArray<readonly Member[]>): Member[] {
  const byName = new Map<string, Member>()
  for (const members of branches) {
    for (const member of members) {
      const known = byName.get(member.name)
      byName.set(
        member.name,
        known
          ? {
              ...known,
              optional: known.optional || member.optional,
              types: [...known.types, ...member.types],
            }
          : member,
      )
    }
  }
  return [...byName.values()].map((member) =>
    branches.every((members) => members.some((other) => other.name === member.name))
      ? member
      : { ...member, optional: true },
  )
}

function quoted(node: Node): string {
  const text = typeText(node)
  return `\`${text.length > 48 ? `${text.slice(0, 47)}…` : text}\``
}

/** One kind for every type a member is declared with. */
function memberKind(types: readonly TypeNode[], domainRoot: string): Kind {
  if (types.length === 0) return UNKNOWN
  const kinds = types.map((type) => kindOf(type, domainRoot, 0))
  return kinds.length === 1 ? kinds[0]! : joined(kinds)
}

/** The item type of a list type; the type itself otherwise. */
function itemType(type: TypeNode, domainRoot: string, depth = 0): TypeNode {
  const value = unwrapType(type)
  if (depth > MAX_TYPE_DEPTH) return value
  if (Node.isArrayTypeNode(value)) return value.getElementTypeNode()
  if (Node.isTypeOperatorTypeNode(value) && value.getOperator() === SyntaxKind.ReadonlyKeyword)
    return itemType(value.getTypeNode(), domainRoot, depth + 1)
  if (Node.isUnionTypeNode(value)) {
    const present = value.getTypeNodes().filter((branch) => !isAbsent(branch))
    return present.length === 1 ? itemType(present[0]!, domainRoot, depth + 1) : value
  }
  if (Node.isTypeReference(value)) {
    const name = value.getTypeName()
    const first = value.getTypeArguments()[0]
    if (Node.isIdentifier(name) && first) {
      const resolved = named(name, domainRoot)
      if ('reason' in resolved && COLLECTIONS.has(name.getText())) return first
      if ('reason' in resolved && name.getText() === 'Readonly')
        return itemType(first, domainRoot, depth + 1)
    }
  }
  return value
}

/**
 * The input `build` declares: the parameter's type, or `written`, the type the call names for it
 * (`defineMutation<S>()<Input, Output>(…)`) when the parameter declares none.
 */
export function declaredInput(
  build: Callable,
  written: TypeNode | undefined,
  domainRoot: string,
): DeclaredInput {
  const parameter = build.getParameters()[0]
  const none = (form: 'none' | 'unread', gap?: DeclaredInput['gap']): DeclaredInput => ({
    form,
    fields: [],
    ...(gap ? { gap } : {}),
    membersAt: () => undefined,
  })
  if (!parameter) return none('none')
  const type = parameter.getTypeNode() ?? written
  if (!type)
    return none('unread', {
      at: parameter,
      reason: 'takes an input whose type the source does not declare',
    })
  const place = (node: Node) => ({
    file: relToRoot(domainRoot, node.getSourceFile().getFilePath()),
    line: node.getStartLineNumber(),
  })
  const shape = shapeOf(type, domainRoot, 0)
  if (shape.form === 'none') return none('none')
  if (shape.form === 'unread') return none('unread', { at: shape.at, reason: shape.reason })
  if (shape.form === 'value') {
    const kind = kindOf(type, domainRoot, 0)
    const doc = leadingDoc(parameter)
    const field: DeclaredField = {
      name: parameter.getNameNode().getText(),
      optional: parameter.hasQuestionToken() || parameter.hasInitializer(),
      type: typeText(type),
      kind: kind.kind,
      ...(kind.literals ? { literals: [...kind.literals] } : {}),
      ...(doc ? { doc } : {}),
      ...place(parameter),
    }
    return {
      form: 'value',
      fields: [field],
      membersAt: (path) => membersOf([type], path, domainRoot),
    }
  }
  const fields = shape.members.map((member): DeclaredField => {
    const kind = memberKind(member.types, domainRoot)
    const doc = leadingDoc(member.at)
    return {
      name: member.name,
      optional: member.optional,
      type: [...new Set(member.types.map(typeText))].join(' | '),
      kind: kind.kind,
      ...(kind.literals ? { literals: [...kind.literals] } : {}),
      ...(doc ? { doc } : {}),
      ...place(member.at),
    }
  })
  const types = new Map(shape.members.map((member) => [member.name, member.types]))
  return {
    form: 'fields',
    fields,
    membersAt: (path) => {
      if (path.length === 0) return fields.map((field) => field.name)
      const declared = types.get(path[0]!)
      return declared && membersOf(declared, path.slice(1), domainRoot)
    },
  }
}

/** The member names the value of one of `types` holds under `path`, each list read as its item. */
function membersOf(
  types: readonly TypeNode[],
  path: readonly string[],
  domainRoot: string,
): readonly string[] | undefined {
  if (types.length !== 1) return undefined
  const shape = shapeOf(itemType(types[0]!, domainRoot), domainRoot, 0)
  if (shape.form !== 'fields') return undefined
  if (path.length === 0) return shape.members.map((member) => member.name)
  const member = shape.members.find((candidate) => candidate.name === path[0])
  return member && membersOf(member.types, path.slice(1), domainRoot)
}
