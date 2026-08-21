/**
 * Canonical Studio identity for DomainSchema references.
 *
 * These helpers validate and encode only the structural wire coordinate. SDK
 * admission remains the authority for whether a reference is semantically valid.
 */

export const IR_SCHEMA_REF_KINDS = [
  'type',
  'interface',
  'class',
  'function',
  'policy',
  'view',
  'core',
] as const

export type IrSchemaRefKind = (typeof IR_SCHEMA_REF_KINDS)[number]

/** Exact structural coordinate embedded in a canonical DomainSchema V1 root. */
export interface IrSchemaRef {
  origin: string
  kind: IrSchemaRefKind
  name: string
}

/** Canonical DSL key for a schema member: `origin:kind.name`. */
export type IrSchemaKey = `${string}:${IrSchemaRefKind}.${string}`

export type IrDefinitionRef = Omit<IrSchemaRef, 'kind'> & {
  kind: 'class' | 'interface'
}

export type IrDefinitionKey = `${string}:${IrDefinitionRef['kind']}.${string}`

const schemaKinds = new Set<string>(IR_SCHEMA_REF_KINDS)
const schemaKeyPattern = /^(.+):(type|interface|class|function|policy|view|core)\.(.+)$/

/** Structural guard only; it deliberately does not perform SDK admission. */
export function isIrSchemaRef(value: unknown): value is IrSchemaRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Partial<IrSchemaRef>
  return (
    typeof ref.origin === 'string' &&
    typeof ref.name === 'string' &&
    typeof ref.kind === 'string' &&
    schemaKinds.has(ref.kind)
  )
}

export function isIrDefinitionRef(value: unknown): value is IrDefinitionRef {
  return isIrSchemaRef(value) && (value.kind === 'class' || value.kind === 'interface')
}

export function isIrInterfaceRef(value: unknown): value is IrDefinitionRef & { kind: 'interface' } {
  return isIrSchemaRef(value) && value.kind === 'interface'
}

export function schemaRefKey(ref: IrSchemaRef): IrSchemaKey {
  return `${ref.origin}:${ref.kind}.${ref.name}`
}

export function definitionRefKey(ref: IrDefinitionRef): IrDefinitionKey {
  return `${ref.origin}:${ref.kind}.${ref.name}`
}

/** Parse a canonical key without asserting that the referenced member exists. */
export function parseSchemaRefKey(value: unknown): IrSchemaRef | undefined {
  if (typeof value !== 'string') return undefined
  const match = schemaKeyPattern.exec(value)
  if (!match) return undefined
  return {
    origin: match[1],
    kind: match[2] as IrSchemaRefKind,
    name: match[3],
  }
}

export function parseDefinitionRefKey(value: unknown): IrDefinitionRef | undefined {
  const ref = parseSchemaRefKey(value)
  return ref && isIrDefinitionRef(ref) ? ref : undefined
}
