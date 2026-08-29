/** Structural admission for persisted Studio render IR. SDK admission is separate. */

import type {
  IrClass,
  IrClassRef,
  IrFunction,
  IrMethod,
  IrSchemaRef,
  JsonSchema,
  SchemaIR,
} from '../../shared/types'

import { asJsonRecord, asStringArray } from '../json'

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
    ['class', 'function', 'policy', 'view', 'core'].includes(String(record.kind))
  )
}

function isClassRef(value: unknown): value is IrClassRef {
  return isSchemaRef(value) && value.kind === 'class'
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
    isJsonSchema(record.input) &&
    isOutput(record.output) &&
    typeof record.static === 'boolean' &&
    ['default', 'abstract', 'sealed'].includes(String(record.inheritance))
  )
}

function isEndpoint(value: unknown): boolean {
  const record = asJsonRecord(value)
  if (!record || typeof record.name !== 'string' || !asStringArray(record.types)) return false
  if (
    record.refs !== undefined &&
    (!Array.isArray(record.refs) || !record.refs.every(isSchemaRef))
  ) {
    return false
  }
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

function isClass(value: unknown): value is IrClass {
  const record = asJsonRecord(value)
  return (
    (record?.type === 'node' || record?.type === 'edge') &&
    typeof record.name === 'string' &&
    typeof record.origin === 'string' &&
    isClassRef(record.ref) &&
    recordOf(record.properties, isJsonSchema) &&
    recordOf(record.methods, isMethod) &&
    (record.required === undefined || asStringArray(record.required) !== undefined) &&
    (record.extends === undefined || asStringArray(record.extends) !== undefined) &&
    (record.extendsRefs === undefined ||
      (Array.isArray(record.extendsRefs) && record.extendsRefs.every(isClassRef))) &&
    (record.endpoints === undefined ||
      (Array.isArray(record.endpoints) && record.endpoints.every(isEndpoint)))
  )
}

function isFunction(value: unknown): value is IrFunction {
  const record = asJsonRecord(value)
  return typeof record?.name === 'string' && isJsonSchema(record.input) && isOutput(record.output)
}

function isImport(value: unknown): boolean {
  const record = asJsonRecord(value)
  return (
    typeof record?.origin === 'string' &&
    isClassRef(record.ref) &&
    typeof record.key === 'string' &&
    record.key === `${record.ref.origin}:class.${record.ref.name}`
  )
}

function isView(value: unknown): boolean {
  const record = asJsonRecord(value)
  const target = asJsonRecord(record?.target)
  return (
    typeof record?.name === 'string' &&
    record.auth === undefined &&
    !!target &&
    (target.kind === 'domain' ||
      (target.kind === 'definition' &&
        Array.isArray(target.definitions) &&
        target.definitions.every(isSchemaRef)))
  )
}

export function decodeSchemaIR(value: unknown): SchemaIR | undefined {
  const record = asJsonRecord(value)
  if (
    !record ||
    record.format !== 'astrale.dsl' ||
    record.version !== 'v1' ||
    typeof record.domain !== 'string' ||
    !recordOf(record.classes, isClass) ||
    !recordOf(record.functions, isFunction) ||
    !recordOf(record.importsByKey, isImport) ||
    !recordOf(record.importedClassesByKey, isClass) ||
    !recordOf(record.views, isView) ||
    !asJsonRecord(record.policies) ||
    !Array.isArray(record.dependencies) ||
    !record.dependencies.every((dependency) => {
      const item = asJsonRecord(dependency)
      return typeof item?.origin === 'string' && typeof item.revision === 'string'
    }) ||
    !('core' in record)
  ) {
    return undefined
  }
  return record as unknown as SchemaIR
}
