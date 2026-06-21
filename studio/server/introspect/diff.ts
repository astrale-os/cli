/**
 * diff.ts — structural diff of two Schema IRs + breaking/additive classification.
 * Shared by change tracking (baseline) and data versioning. Pure.
 *
 * Optionality is encoded in JSON Schema as a `type` array containing 'null'.
 * BREAKING: any removal/rename, prop type change, optional→required, method
 * signature change. ADDITIVE: only additions, or required→optional.
 */
import type {
  IrClass,
  IrInterface,
  IrMethod,
  JsonSchema,
  SchemaChange,
  SchemaIR,
} from '../../shared/types'

export function isOptional(s: JsonSchema | undefined): boolean {
  if (!s) return false
  return Array.isArray(s.type) ? s.type.includes('null') : false
}

export function baseType(s: JsonSchema | undefined): string {
  if (!s) return 'unknown'
  const t = s.type
  if (Array.isArray(t)) {
    const base = t.filter((x) => x !== 'null')
    return (base.length ? base.join('|') : 'null') + (s.enum ? `(${s.enum.join(',')})` : '')
  }
  if (typeof t === 'string') return t + (s.enum ? `(${s.enum.join(',')})` : '')
  return s.enum ? `enum(${s.enum.join(',')})` : 'unknown'
}

function methodSig(m: IrMethod): string {
  const params = Object.entries(m.params ?? {})
    .map(([k, v]) => `${k}:${baseType(v)}${isOptional(v) ? '?' : ''}`)
    .sort()
    .join(',')
  return `static=${m.static};in=${params};out=${baseType(m.returns)};inh=${m.inheritance}`
}

export function diffSchemas(prev: SchemaIR | null, next: SchemaIR | null): SchemaChange[] {
  const changes: SchemaChange[] = []
  if (!prev || !next) return changes

  diffMembers(prev.interfaces ?? {}, next.interfaces ?? {}, 'interface', changes)
  diffMembers(prev.classes ?? {}, next.classes ?? {}, 'class', changes)
  return changes
}

function memberKind(m: IrClass | IrInterface): 'class' | 'edge' | 'interface' {
  if ((m as IrInterface).type === 'interface') return 'interface'
  return (m as IrClass).type === 'edge' ? 'edge' : 'class'
}

function diffMembers(
  prev: Record<string, IrClass | IrInterface>,
  next: Record<string, IrClass | IrInterface>,
  _scope: 'class' | 'interface',
  out: SchemaChange[],
): void {
  for (const name of Object.keys(next)) {
    if (!prev[name]) {
      const k = memberKind(next[name])
      out.push({ kind: `${k}-added` as SchemaChange['kind'], target: name, breaking: false })
    }
  }
  for (const name of Object.keys(prev)) {
    if (!next[name]) {
      const k = memberKind(prev[name])
      out.push({ kind: `${k}-removed` as SchemaChange['kind'], target: name, breaking: true })
      continue
    }
    diffMemberBody(name, prev[name], next[name], out)
  }
}

function diffMemberBody(
  name: string,
  a: IrClass | IrInterface,
  b: IrClass | IrInterface,
  out: SchemaChange[],
): void {
  const pa = a.properties ?? {}
  const pb = b.properties ?? {}
  for (const p of Object.keys(pb)) {
    if (!pa[p]) out.push({ kind: 'prop-added', target: `${name}.${p}`, breaking: false })
  }
  for (const p of Object.keys(pa)) {
    if (!pb[p]) {
      out.push({ kind: 'prop-removed', target: `${name}.${p}`, breaking: true })
      continue
    }
    if (baseType(pa[p]) !== baseType(pb[p])) {
      out.push({
        kind: 'prop-type-changed',
        target: `${name}.${p}`,
        detail: `${baseType(pa[p])} → ${baseType(pb[p])}`,
        breaking: true,
      })
    }
    const wasOpt = isOptional(pa[p])
    const nowOpt = isOptional(pb[p])
    if (wasOpt !== nowOpt) {
      out.push({
        kind: 'prop-required-changed',
        target: `${name}.${p}`,
        detail: wasOpt ? 'optional → required' : 'required → optional',
        breaking: wasOpt && !nowOpt, // optional→required is breaking
      })
    }
  }

  const ma = a.methods ?? {}
  const mb = b.methods ?? {}
  for (const m of Object.keys(mb)) {
    if (!ma[m]) out.push({ kind: 'method-added', target: `${name}.${m}`, breaking: false })
  }
  for (const m of Object.keys(ma)) {
    if (!mb[m]) {
      out.push({ kind: 'method-removed', target: `${name}.${m}`, breaking: true })
      continue
    }
    if (methodSig(ma[m]) !== methodSig(mb[m])) {
      out.push({ kind: 'method-signature-changed', target: `${name}.${m}`, breaking: true })
    }
  }
}

export function classify(changes: SchemaChange[]): 'none' | 'additive' | 'breaking' {
  if (changes.length === 0) return 'none'
  return changes.some((c) => c.breaking) ? 'breaking' : 'additive'
}
