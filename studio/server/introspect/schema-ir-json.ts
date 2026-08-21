/** Structural admission for persisted Studio render IR. SDK admission is separate. */

import type {
  IrFunction,
  IrInterface,
  IrMethod,
  IrSchemaRef,
  JsonSchema,
  SchemaIR,
} from '../../shared/types'

import { asJsonRecord, asStringArray } from '../json'

function optional<T>(value: unknown, guard: (candidate: unknown) => candidate is T): boolean {
  return value === undefined || guard(value)
}

function recordOf(value: unknown, guard: (candidate: unknown) => boolean): boolean {
  const record = asJsonRecord(value)
  return !!record && Object.values(record).every(guard)
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return !!asJsonRecord(value)
}

function isSchemaRef(value: unknown): value is IrSchemaRef {
  const record = asJsonRecord(value)
  return (
    typeof record?.origin === 'string' &&
    typeof record.name === 'string' &&
    ['type', 'interface', 'class', 'function', 'policy', 'view', 'core'].includes(
      String(record.kind),
    )
  )
}

function isSchemaRefArray(value: unknown): value is IrSchemaRef[] {
  return Array.isArray(value) && value.every(isSchemaRef)
}

function isOutput(value: unknown): boolean {
  const record = asJsonRecord(value)
  if (!record) return false
  if (record.mode === 'binary') return true
  if (record.mode === 'value') return isJsonSchema(record.schema)
  if (record.mode === 'stream') return isJsonSchema(record.item)
  return false
}

function isMethod(value: unknown): value is IrMethod {
  const record = asJsonRecord(value)
  return (
    typeof record?.name === 'string' &&
    recordOf(record.params, isJsonSchema) &&
    isJsonSchema(record.returns) &&
    typeof record.static === 'boolean' &&
    ['default', 'abstract', 'sealed'].includes(String(record.inheritance)) &&
    optional(record.input, isJsonSchema) &&
    (record.requiredParams === undefined || asStringArray(record.requiredParams) !== undefined) &&
    (record.output === undefined || isOutput(record.output))
  )
}

function isEndpoint(value: unknown): boolean {
  const record = asJsonRecord(value)
  if (!record || typeof record.name !== 'string' || !asStringArray(record.types)) return false
  if (record.refs !== undefined && !isSchemaRefArray(record.refs)) return false
  if (record.cardinality !== undefined) {
    const cardinality = asJsonRecord(record.cardinality)
    if (
      !cardinality ||
      typeof cardinality.min !== 'number' ||
      !Number.isFinite(cardinality.min) ||
      (cardinality.max !== null &&
        (typeof cardinality.max !== 'number' || !Number.isFinite(cardinality.max)))
    ) {
      return false
    }
  }
  return true
}

function isInterface(value: unknown): value is IrInterface {
  const record = asJsonRecord(value)
  return (
    record?.type === 'interface' &&
    typeof record.name === 'string' &&
    recordOf(record.properties, isJsonSchema) &&
    recordOf(record.methods, isMethod) &&
    (record.required === undefined || asStringArray(record.required) !== undefined) &&
    (record.extends === undefined || asStringArray(record.extends) !== undefined) &&
    (record.extendsRefs === undefined || isSchemaRefArray(record.extendsRefs)) &&
    (record.endpoints === undefined ||
      (Array.isArray(record.endpoints) && record.endpoints.every(isEndpoint)))
  )
}

function isClass(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    (record?.type === 'node' || record?.type === 'edge') &&
    typeof record.name === 'string' &&
    recordOf(record.properties, isJsonSchema) &&
    recordOf(record.methods, isMethod) &&
    (record.required === undefined || asStringArray(record.required) !== undefined) &&
    (record.implements === undefined || asStringArray(record.implements) !== undefined) &&
    (record.implementsRefs === undefined || isSchemaRefArray(record.implementsRefs)) &&
    (record.endpoints === undefined ||
      (Array.isArray(record.endpoints) && record.endpoints.every(isEndpoint)))
  )
}

function isFunction(value: unknown): value is IrFunction {
  const record = asJsonRecord(value)
  return (
    typeof record?.name === 'string' &&
    isJsonSchema(record.input) &&
    recordOf(record.params, isJsonSchema) &&
    (record.requiredParams === undefined || asStringArray(record.requiredParams) !== undefined) &&
    isOutput(record.output) &&
    isJsonSchema(record.returns) &&
    record.static === true &&
    record.inheritance === 'default'
  )
}

function isImport(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.origin === 'string' &&
    (record.definition === 'class' || record.definition === 'interface') &&
    optional(record.ref, isSchemaRef)
  )
}

function isView(value: unknown): boolean {
  const record = asJsonRecord(value)
  const target = asJsonRecord(record?.target)
  return (
    typeof record?.name === 'string' &&
    ['required', 'optional', 'public'].includes(String(record.auth)) &&
    !!target &&
    (target.kind === 'domain' ||
      (target.kind === 'definition' && isSchemaRefArray(target.definitions)))
  )
}

export function decodeSchemaIR(value: unknown): SchemaIR | undefined {
  const record = asJsonRecord(value)
  if (
    !record ||
    typeof record.version !== 'string' ||
    typeof record.domain !== 'string' ||
    !recordOf(record.types, isJsonSchema) ||
    !recordOf(record.interfaces, isInterface) ||
    !recordOf(record.classes, isClass) ||
    !recordOf(record.imports, isImport) ||
    !recordOf(record.functions, isFunction) ||
    (record.importsByKey !== undefined && !recordOf(record.importsByKey, isImport)) ||
    (record.importedInterfacesByKey !== undefined &&
      !recordOf(record.importedInterfacesByKey, isInterface)) ||
    (record.views !== undefined && !recordOf(record.views, isView)) ||
    (record.policies !== undefined && !asJsonRecord(record.policies)) ||
    (record.dependencies !== undefined &&
      (!Array.isArray(record.dependencies) ||
        !record.dependencies.every((dependency) => {
          const item = asJsonRecord(dependency)
          return typeof item?.origin === 'string' && typeof item.revision === 'string'
        })))
  ) {
    return undefined
  }
  return record as unknown as SchemaIR
}

export function decodeIrInterfaceRecord(value: unknown): Record<string, IrInterface> | undefined {
  const record = asJsonRecord(value)
  if (!record || !Object.values(record).every(isInterface)) return undefined
  return record as unknown as Record<string, IrInterface>
}
