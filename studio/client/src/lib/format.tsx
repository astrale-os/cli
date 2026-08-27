import type { JsonSchema, TypeDescriptor } from '@shared/types'

import { isNodePathSchema } from '@shared/types'

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

/** Inline monospace type chip. */
export function TypeChip({ schema, className }: { schema?: JsonSchema; className?: string }) {
  const d = describe(schema)
  return (
    <span className={cn('font-mono text-xs text-foreground/80', className)}>
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

/** "just now" · "12 min ago" · "3 h ago" · "2 d ago" · "19 Aug". */
export function relativeTime(iso: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days} d ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
