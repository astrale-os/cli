/**
 * diff.ts — indicative structural diff of two Studio render IRs. Pure.
 *
 * Canonical V1 keeps optionality in the owning `required` arrays and nullability
 * in each value schema. This inventory makes no installation or data-migration claim;
 * only the Kernel Runtime can assess those transitions against installed data.
 */
import type {
  IrClass,
  IrFunction,
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

function callableContract(m: IrMethod | IrFunction): unknown {
  return {
    input: m.input,
    output: m.output,
    ...('static' in m ? { static: m.static, inheritance: m.inheritance } : {}),
    auth: m.auth,
    policy: m.policy,
  }
}

export function diffSchemas(prev: SchemaIR | null, next: SchemaIR | null): SchemaChange[] {
  const changes: SchemaChange[] = []
  if (!prev || !next) return changes

  if (
    !same(
      { format: prev.format, version: prev.version, domain: prev.domain },
      {
        format: next.format,
        version: next.version,
        domain: next.domain,
      },
    )
  ) {
    changes.push({ kind: 'schema-metadata-changed', target: next.domain })
  }

  diffValueRecord(prev.importsByKey, next.importsByKey, 'import', changes)
  diffMembers(prev.classes, next.classes, changes)
  diffFunctions(prev.functions ?? {}, next.functions ?? {}, changes)
  diffViews(prev.views ?? {}, next.views ?? {}, changes)
  diffValueRecord(prev.policies ?? {}, next.policies ?? {}, 'policy', changes)
  diffDependencies(prev.dependencies ?? [], next.dependencies ?? [], changes)
  if (!same(prev.core, next.core) && (prev.core !== undefined || next.core !== undefined)) {
    changes.push({ kind: 'core-changed', target: next.domain })
  }
  return changes
}

function diffValueRecord(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  scope: 'import' | 'policy',
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!(name in prev)) {
      out.push({ kind: `${scope}-added`, target: name })
    }
  }
  for (const name of sortedKeys(prev)) {
    if (!(name in next)) {
      out.push({ kind: `${scope}-removed`, target: name })
    } else if (!same(prev[name], next[name])) {
      out.push({ kind: `${scope}-changed`, target: name })
    }
  }
}

function diffFunctions(
  prev: Record<string, IrFunction>,
  next: Record<string, IrFunction>,
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!prev[name]) out.push({ kind: 'function-added', target: name })
  }
  for (const name of sortedKeys(prev)) {
    if (!next[name]) {
      out.push({ kind: 'function-removed', target: name })
      continue
    }
    if (!same(callableContract(prev[name]), callableContract(next[name]))) {
      out.push({ kind: 'function-signature-changed', target: name })
    }
    if (prev[name].description !== next[name].description) {
      out.push({ kind: 'function-metadata-changed', target: name })
    }
  }
}

function diffViews(
  prev: NonNullable<SchemaIR['views']>,
  next: NonNullable<SchemaIR['views']>,
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!(name in prev)) out.push({ kind: 'view-added', target: name })
  }
  for (const name of sortedKeys(prev)) {
    if (!(name in next)) {
      out.push({ kind: 'view-removed', target: name })
      continue
    }
    if (!same(prev[name].target, next[name].target)) {
      out.push({ kind: 'view-changed', target: name })
    }
    if (prev[name].description !== next[name].description) {
      out.push({ kind: 'view-metadata-changed', target: name })
    }
  }
}

function diffDependencies(
  prev: NonNullable<SchemaIR['dependencies']>,
  next: NonNullable<SchemaIR['dependencies']>,
  out: SchemaChange[],
): void {
  const before = Object.fromEntries(
    prev.map((dependency) => [dependency.origin, dependency.revision]),
  )
  const after = Object.fromEntries(
    next.map((dependency) => [dependency.origin, dependency.revision]),
  )
  for (const origin of sortedKeys(after)) {
    if (!(origin in before)) {
      out.push({ kind: 'dependency-added', target: origin })
    }
  }
  for (const origin of sortedKeys(before)) {
    if (!(origin in after)) {
      out.push({ kind: 'dependency-removed', target: origin })
    } else if (before[origin] !== after[origin]) {
      out.push({
        kind: 'dependency-changed',
        target: origin,
        detail: `${before[origin]} → ${after[origin]}`,
      })
    }
  }
}

function memberKind(member: IrClass): 'class' | 'edge' {
  return member.type === 'edge' ? 'edge' : 'class'
}

function diffMembers(
  prev: Record<string, IrClass>,
  next: Record<string, IrClass>,
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!prev[name]) {
      const k = memberKind(next[name])
      out.push({ kind: `${k}-added` as SchemaChange['kind'], target: name })
    }
  }
  for (const name of sortedKeys(prev)) {
    if (!next[name]) {
      const k = memberKind(prev[name])
      out.push({ kind: `${k}-removed` as SchemaChange['kind'], target: name })
      continue
    }
    diffMemberBody(name, prev[name], next[name], out)
  }
}

function diffMemberBody(name: string, a: IrClass, b: IrClass, out: SchemaChange[]): void {
  const pa = a.properties ?? {}
  const pb = b.properties ?? {}
  for (const p of sortedKeys(pb)) {
    if (!pa[p]) {
      const required = propertyRequired(b, p)
      out.push({
        kind: 'prop-added',
        target: `${name}.${p}`,
        detail: required ? 'required' : 'optional',
      })
    }
  }
  for (const p of sortedKeys(pa)) {
    if (!pb[p]) {
      out.push({ kind: 'prop-removed', target: `${name}.${p}` })
      continue
    }
    if (!same(pa[p], pb[p])) {
      const baseChanged = baseType(pa[p]) !== baseType(pb[p])
      out.push({
        kind: baseChanged ? 'prop-type-changed' : 'prop-schema-changed',
        target: `${name}.${p}`,
        detail: baseChanged
          ? `${baseType(pa[p])} → ${baseType(pb[p])}`
          : 'value constraints changed',
      })
    }
    const wasOpt = !propertyRequired(a, p)
    const nowOpt = !propertyRequired(b, p)
    if (wasOpt !== nowOpt) {
      out.push({
        kind: 'prop-required-changed',
        target: `${name}.${p}`,
        detail: wasOpt ? 'optional → required' : 'required → optional',
      })
    }
  }

  const ma = a.methods ?? {}
  const mb = b.methods ?? {}
  for (const m of sortedKeys(mb)) {
    if (!ma[m]) {
      out.push({
        kind: 'method-added',
        target: `${name}.${m}`,
      })
    }
  }
  for (const m of sortedKeys(ma)) {
    if (!mb[m]) {
      out.push({ kind: 'method-removed', target: `${name}.${m}` })
      continue
    }
    if (!same(callableContract(ma[m]), callableContract(mb[m]))) {
      out.push({ kind: 'method-signature-changed', target: `${name}.${m}` })
    }
    if (ma[m].description !== mb[m].description) {
      out.push({ kind: 'method-metadata-changed', target: `${name}.${m}` })
    }
  }

  const kind = memberKind(b)
  if (!same(memberContract(a), memberContract(b))) {
    out.push({
      kind: `${kind}-contract-changed`,
      target: name,
    })
  }
  if (!same(memberMetadata(a), memberMetadata(b))) {
    out.push({ kind: 'definition-metadata-changed', target: name })
  }
}

function propertyRequired(member: IrClass, name: string): boolean {
  return member.required ? member.required.includes(name) : !isOptional(member.properties?.[name])
}

function memberContract(member: IrClass): unknown {
  return {
    type: member.type,
    origin: member.origin,
    ref: member.ref,
    extends: member.extendsRefs ?? member.extends,
    endpoints: member.endpoints,
    orientation: member.orientation,
    constraints: member.constraints,
    propertyMetadata: member.propertyMetadata,
    data: member.data,
    policies: member.policies,
  }
}

function memberMetadata(member: IrClass): unknown {
  return { description: member.description, icon: member.icon }
}

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort((left, right) => left.localeCompare(right))
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  )
}

export function structuralStatusOf(changes: SchemaChange[]): 'none' | 'changed' {
  return changes.length === 0 ? 'none' : 'changed'
}
