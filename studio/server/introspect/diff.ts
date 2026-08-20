/**
 * diff.ts — structural diff of two Schema IRs + breaking/additive classification.
 * Shared by change tracking (baseline) and data versioning. Pure.
 *
 * Canonical V1 keeps optionality in the owning `required` arrays and nullability
 * in each value schema. Legacy nullable projections remain supported. Contract
 * changes are classified conservatively: removals, tightened value schemas,
 * callable/auth/policy changes, topology changes, dependency revisions and Core
 * changes are breaking; pure additions and descriptions are additive.
 */
import type {
  IrClass,
  IrFunction,
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

function requiredParams(m: IrMethod | IrFunction): string[] {
  return (
    m.requiredParams ??
    Object.entries(m.params ?? {}).flatMap(([name, schema]) => (isOptional(schema) ? [] : [name]))
  )
}

function callableContract(m: IrMethod | IrFunction): unknown {
  const required = requiredParams(m)
  return {
    input:
      m.input ??
      ({
        type: 'object',
        properties: m.params ?? {},
        required,
        additionalProperties: false,
      } satisfies JsonSchema),
    required,
    output: m.output ?? { mode: 'value', schema: m.returns },
    static: m.static,
    inheritance: m.inheritance,
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
    changes.push({ kind: 'schema-metadata-changed', target: next.domain, breaking: true })
  }

  diffValueRecord(prev.types ?? {}, next.types ?? {}, 'type', changes)
  diffValueRecord(
    prev.importsByKey ?? prev.imports ?? {},
    next.importsByKey ?? next.imports ?? {},
    'import',
    changes,
  )
  diffMembers(prev.interfaces ?? {}, next.interfaces ?? {}, 'interface', changes)
  diffMembers(prev.classes ?? {}, next.classes ?? {}, 'class', changes)
  diffFunctions(prev.functions ?? {}, next.functions ?? {}, changes)
  diffViews(prev.views ?? {}, next.views ?? {}, changes)
  diffValueRecord(prev.policies ?? {}, next.policies ?? {}, 'policy', changes)
  diffDependencies(prev.dependencies ?? [], next.dependencies ?? [], changes)
  if (!same(prev.core, next.core) && (prev.core !== undefined || next.core !== undefined)) {
    changes.push({ kind: 'core-changed', target: next.domain, breaking: prev.core !== undefined })
  }
  return changes
}

function diffValueRecord(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  scope: 'type' | 'import' | 'policy',
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!(name in prev)) {
      out.push({ kind: `${scope}-added`, target: name, breaking: false })
    }
  }
  for (const name of sortedKeys(prev)) {
    if (!(name in next)) {
      out.push({ kind: `${scope}-removed`, target: name, breaking: true })
    } else if (!same(prev[name], next[name])) {
      out.push({ kind: `${scope}-changed`, target: name, breaking: true })
    }
  }
}

function diffFunctions(
  prev: Record<string, IrFunction>,
  next: Record<string, IrFunction>,
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!prev[name]) out.push({ kind: 'function-added', target: name, breaking: false })
  }
  for (const name of sortedKeys(prev)) {
    if (!next[name]) {
      out.push({ kind: 'function-removed', target: name, breaking: true })
      continue
    }
    if (!same(callableContract(prev[name]), callableContract(next[name]))) {
      out.push({ kind: 'function-signature-changed', target: name, breaking: true })
    }
    if (prev[name].description !== next[name].description) {
      out.push({ kind: 'function-metadata-changed', target: name, breaking: false })
    }
  }
}

function diffViews(
  prev: NonNullable<SchemaIR['views']>,
  next: NonNullable<SchemaIR['views']>,
  out: SchemaChange[],
): void {
  for (const name of sortedKeys(next)) {
    if (!(name in prev)) out.push({ kind: 'view-added', target: name, breaking: false })
  }
  for (const name of sortedKeys(prev)) {
    if (!(name in next)) {
      out.push({ kind: 'view-removed', target: name, breaking: true })
      continue
    }
    if (
      !same(
        { target: prev[name].target, auth: prev[name].auth },
        {
          target: next[name].target,
          auth: next[name].auth,
        },
      )
    ) {
      out.push({ kind: 'view-changed', target: name, breaking: true })
    }
    if (prev[name].description !== next[name].description) {
      out.push({ kind: 'view-metadata-changed', target: name, breaking: false })
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
      out.push({ kind: 'dependency-added', target: origin, breaking: true })
    }
  }
  for (const origin of sortedKeys(before)) {
    if (!(origin in after)) {
      out.push({ kind: 'dependency-removed', target: origin, breaking: true })
    } else if (before[origin] !== after[origin]) {
      out.push({
        kind: 'dependency-changed',
        target: origin,
        detail: `${before[origin]} → ${after[origin]}`,
        breaking: true,
      })
    }
  }
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
  for (const name of sortedKeys(next)) {
    if (!prev[name]) {
      const k = memberKind(next[name])
      out.push({ kind: `${k}-added` as SchemaChange['kind'], target: name, breaking: false })
    }
  }
  for (const name of sortedKeys(prev)) {
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
  for (const p of sortedKeys(pb)) {
    if (!pa[p]) {
      const required = propertyRequired(b, p)
      out.push({
        kind: 'prop-added',
        target: `${name}.${p}`,
        detail: required ? 'required' : 'optional',
        breaking: required,
      })
    }
  }
  for (const p of sortedKeys(pa)) {
    if (!pb[p]) {
      out.push({ kind: 'prop-removed', target: `${name}.${p}`, breaking: true })
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
        breaking: true,
      })
    }
    const wasOpt = !propertyRequired(a, p)
    const nowOpt = !propertyRequired(b, p)
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
  for (const m of sortedKeys(mb)) {
    if (!ma[m]) {
      out.push({
        kind: 'method-added',
        target: `${name}.${m}`,
        breaking: b.type === 'interface' && mb[m].inheritance === 'abstract',
      })
    }
  }
  for (const m of sortedKeys(ma)) {
    if (!mb[m]) {
      out.push({ kind: 'method-removed', target: `${name}.${m}`, breaking: true })
      continue
    }
    if (!same(callableContract(ma[m]), callableContract(mb[m]))) {
      out.push({ kind: 'method-signature-changed', target: `${name}.${m}`, breaking: true })
    }
    if (ma[m].description !== mb[m].description) {
      out.push({ kind: 'method-metadata-changed', target: `${name}.${m}`, breaking: false })
    }
  }

  const kind = memberKind(b)
  if (!same(memberContract(a), memberContract(b))) {
    out.push({
      kind: `${kind}-contract-changed`,
      target: name,
      breaking: true,
    })
  }
  if (!same(memberMetadata(a), memberMetadata(b))) {
    out.push({ kind: 'definition-metadata-changed', target: name, breaking: false })
  }
}

function propertyRequired(member: IrClass | IrInterface, name: string): boolean {
  return member.required ? member.required.includes(name) : !isOptional(member.properties?.[name])
}

function memberContract(member: IrClass | IrInterface): unknown {
  const cls = member as IrClass
  const iface = member as IrInterface
  return {
    type: member.type,
    origin: member.origin,
    ref: member.ref,
    family: iface.family,
    extends: iface.extendsRefs ?? iface.extends,
    implements: cls.implementsRefs ?? cls.implements,
    endpoints: member.endpoints,
    orientation: member.orientation,
    constraints: member.constraints,
    propertyMetadata: member.propertyMetadata,
    data: member.data,
    policies: cls.policies,
  }
}

function memberMetadata(member: IrClass | IrInterface): unknown {
  return { description: member.description, icon: (member as IrClass).icon }
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

export function classify(changes: SchemaChange[]): 'none' | 'additive' | 'breaking' {
  if (changes.length === 0) return 'none'
  return changes.some((c) => c.breaking) ? 'breaking' : 'additive'
}
