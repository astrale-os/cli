import type { JsonSchema, TypeDescriptor } from '@shared/types'

import { cn } from './utils'

/** JSON Schema → render-friendly descriptor (never reads zod). */
export function describe(s?: JsonSchema): TypeDescriptor {
  if (!s) return { kind: 'unknown', optional: false }
  const t = s.type
  const optional = Array.isArray(t) ? t.includes('null') : false
  const base = Array.isArray(t)
    ? (t.find((x) => x !== 'null') as string | undefined)
    : (t as string | undefined)
  if (s.enum) return { kind: 'enum', values: s.enum, optional }
  if (s.$nodeRef) return { kind: 'ref', target: 'node', refKind: 'node', optional }
  if (s.$dataRef) return { kind: 'ref', target: 'data', refKind: 'data', optional }
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

/** Inline monospace type chip. */
export function TypeChip({ schema, className }: { schema?: JsonSchema; className?: string }) {
  const d = describe(schema)
  const colorByKind: Record<string, string> = {
    string: 'text-emerald-400',
    integer: 'text-sky-400',
    number: 'text-sky-400',
    boolean: 'text-amber-400',
    enum: 'text-fuchsia-400',
    object: 'text-violet-400',
    array: 'text-violet-400',
    ref: 'text-rose-400',
    unknown: 'text-muted-foreground',
    null: 'text-muted-foreground',
  }
  return (
    <span
      className={cn('font-mono text-xs', colorByKind[d.kind] ?? 'text-muted-foreground', className)}
    >
      {typeLabel(d)}
      {d.optional && <span className="text-muted-foreground">?</span>}
    </span>
  )
}

export function shortHash(h?: string): string {
  if (!h) return '—'
  return h
    .replace(/^sha256:/, '')
    .replace(/^sha-?/, '')
    .slice(0, 8)
}
