import type { JsonSchema, TypeDescriptor } from '@shared/types'

import { isNodePathSchema } from '@shared/types'
import {
  Braces,
  Circle,
  Hash,
  Link2,
  List,
  ListChecks,
  type LucideIcon,
  ToggleLeft,
  Type,
} from 'lucide-react'

/** JSON Schema → render-friendly descriptor (never reads zod). */
export function describe(s?: JsonSchema): TypeDescriptor {
  if (!s) return { kind: 'unknown', optional: false }
  const t = s.type
  const optional = Array.isArray(t) ? t.includes('null') : false
  const base = Array.isArray(t)
    ? (t.find((x) => x !== 'null') as string | undefined)
    : (t as string | undefined)
  if (s.enum) return { kind: 'enum', values: s.enum, optional }
  if (isNodePathSchema(s)) return { kind: 'ref', target: 'node', optional }
  if (base === 'array') return { kind: 'array', items: describe(s.items), optional }
  if (base === 'object') {
    const fields: Record<string, TypeDescriptor> = {}
    for (const [k, v] of Object.entries(s.properties ?? {})) fields[k] = describe(v as JsonSchema)
    return { kind: 'object', fields, required: s.required ?? [], optional }
  }
  if (
    base === 'string' ||
    base === 'number' ||
    base === 'integer' ||
    base === 'boolean' ||
    base === 'null'
  ) {
    return { kind: base, optional }
  }
  return { kind: 'unknown', optional }
}

export function typeLabel(d: TypeDescriptor): string {
  switch (d.kind) {
    case 'enum':
      return `enum(${d.values.map(String).join(' | ')})`
    case 'array':
      return `${typeLabel(d.items)}[]`
    case 'object':
      return `{ ${Object.keys(d.fields).join(', ')} }`
    case 'ref':
      return `→${d.target}`
    default:
      return d.kind
  }
}

/** A human-friendly name + icon for a property's type (hides zod/JSON-Schema jargon). */
export function friendlyType(
  schema?: JsonSchema,
  optionalOverride?: boolean,
): {
  label: string
  icon: LucideIcon
  optional: boolean
} {
  const d = describe(schema)
  const optional = optionalOverride ?? d.optional
  switch (d.kind) {
    case 'string':
      return { label: 'Text', icon: Type, optional }
    case 'number':
    case 'integer':
      return { label: 'Number', icon: Hash, optional }
    case 'boolean':
      return { label: 'Yes / no', icon: ToggleLeft, optional }
    case 'enum': {
      const vals = d.values.map(String)
      const head = vals.slice(0, 3).join(', ')
      return { label: `One of: ${head}${vals.length > 3 ? '…' : ''}`, icon: ListChecks, optional }
    }
    case 'array':
      return { label: 'List', icon: List, optional }
    case 'object':
      return { label: 'Object', icon: Braces, optional }
    case 'ref':
      return { label: 'Reference', icon: Link2, optional }
    default:
      return { label: 'Value', icon: Circle, optional }
  }
}

/** `friendlyType`, with a List naming what it holds: "List of Text" says more than "List". */
export function friendlyFieldType(
  schema?: JsonSchema,
  optionalOverride?: boolean,
): ReturnType<typeof friendlyType> {
  const ft = friendlyType(schema, optionalOverride)
  if (schema?.items && describe(schema).kind === 'array') {
    return { ...ft, label: `List of ${friendlyType(schema.items).label}` }
  }
  return ft
}

/**
 * The named fields a value schema carries — an object's own properties, or those of the
 * objects a List holds — so a structured input or return reads as rows rather than as
 * one opaque "Object". A Node path is a reference, never opened.
 */
export function fieldChildren(
  schema?: JsonSchema,
): { name: string; schema: JsonSchema; optional: boolean }[] {
  if (!schema) return []
  const kind = describe(schema).kind
  const holder = kind === 'object' ? schema : kind === 'array' ? schema.items : undefined
  if (!holder?.properties) return []
  const required = new Set(holder.required ?? [])
  return Object.entries(holder.properties).map(([name, value]) => ({
    name,
    schema: value,
    optional: !required.has(name),
  }))
}
