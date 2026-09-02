import type { IrMethod, JsonSchema } from '@shared/types'

import {
  Braces,
  Circle,
  Hash,
  Link2,
  List,
  ListChecks,
  Lock,
  type LucideIcon,
  Puzzle,
  ToggleLeft,
  Type,
  Zap,
} from 'lucide-react'

import { describe } from './format'

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

/**
 * Icon + tone for a method, derived ONLY from its declared inheritance (reliable
 * schema data — never guessed from the method name). Sealed → a lock (cannot be
 * overridden), abstract → a contract to fulfil, otherwise a plain operation.
 */
export function methodGlyph(method: IrMethod): { icon: LucideIcon; tone: string } {
  if (method.inheritance === 'sealed') return { icon: Lock, tone: 'warning' }
  if (method.inheritance === 'abstract') return { icon: Puzzle, tone: 'fn' }
  return { icon: Zap, tone: 'primary' }
}

/** Short, human label for the params of a method ("no input" / "url, name" / …). */
export function paramSummary(method: IrMethod): string {
  const keys = Object.keys(method.input.properties ?? {})
  if (keys.length === 0) return 'No input'
  return keys.join(', ')
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
