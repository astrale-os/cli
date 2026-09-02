/**
 * policy.ts — the Studio's reading of the DSL V1 Policy language.
 *
 * The server ships policies exactly as the DSL emitted them (`SchemaIR.policies`, a callable's
 * `policy`, a class's `policies`) without typing them. This module is the one place that knows
 * their shape: a structural mirror of the V1 language, decoded defensively so a policy the
 * Studio does not understand renders as "unsupported" instead of taking the section down.
 *
 * The language is small and closed: a pattern is a connected proof made of edge steps between
 * terms (the subject, the protected object or the protected edge's endpoints, and local
 * variables introduced by `exists`), combined with `allOf` / `anyOf`. There is no negation and
 * no predicate on properties — a Policy is purely about connectivity.
 */
import type { IrSchemaRef, SchemaIR } from '@shared/types'

import { isIrSchemaRef, schemaRefKey } from '@shared/types'

// ── language ────────────────────────────────────────────────────────────────

export type PolicyReservedTerm = 'subject' | 'object' | 'source' | 'target'

export type PolicyTerm = { kind: PolicyReservedTerm } | { kind: 'variable'; id: number }

export interface PolicyEdgeStep {
  source: PolicyTerm
  class: IrSchemaRef
  target: PolicyTerm
  /** bounded transitive closure over one edge class; absent ⇒ exactly one hop */
  repeat?: { min: number; max: number }
}

export interface PolicyVariable {
  variable: { kind: 'variable'; id: number }
  class: IrSchemaRef
}

export type PolicyPattern =
  | PolicyEdgeStep
  | { exists: { nodes: PolicyVariable[]; where: PolicyPattern } }
  | { allOf: PolicyPattern[] }
  | { anyOf: PolicyPattern[] }

export type PolicyExpression =
  | { match: PolicyPattern }
  | { allOf: IrSchemaRef[] }
  | { anyOf: IrSchemaRef[] }

export interface Policy {
  ref: IrSchemaRef
  expression: PolicyExpression
  description?: string
}

export type PolicyCheckObject =
  | { kind: 'self' }
  | { kind: 'input'; field: string }
  | { kind: 'ref'; ref: IrSchemaRef }

export interface PolicyCheckLeaf {
  check: IrSchemaRef
  object: PolicyCheckObject
}

export type PolicyCheck = PolicyCheckLeaf | { allOf: PolicyCheck[] } | { anyOf: PolicyCheck[] }

/** What a policy protects: a node (`object`), an edge (`source`/`target`), or nothing but the subject. */
export type PolicyGuard = 'object' | 'edge' | 'subject'

// ── decoding ────────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>

const asRecord = (value: unknown): AnyRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : undefined

const isBoundedInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

function decodeTerm(value: unknown): PolicyTerm | undefined {
  const record = asRecord(value)
  switch (record?.kind) {
    case 'subject':
    case 'object':
    case 'source':
    case 'target':
      return { kind: record.kind }
    case 'variable':
      return isBoundedInt(record.id) ? { kind: 'variable', id: record.id } : undefined
    default:
      return undefined
  }
}

function decodeList<T>(value: unknown, decode: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out: T[] = []
  for (const item of value) {
    const decoded = decode(item)
    if (decoded === undefined) return undefined
    out.push(decoded)
  }
  return out
}

export function decodePolicyPattern(value: unknown): PolicyPattern | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  if ('allOf' in record) {
    const allOf = decodeList(record.allOf, decodePolicyPattern)
    return allOf && { allOf }
  }
  if ('anyOf' in record) {
    const anyOf = decodeList(record.anyOf, decodePolicyPattern)
    return anyOf && { anyOf }
  }
  if ('exists' in record) {
    const exists = asRecord(record.exists)
    const nodes = decodeList(exists?.nodes, (item) => {
      const node = asRecord(item)
      const variable = decodeTerm(node?.variable)
      return variable?.kind === 'variable' && isIrSchemaRef(node?.class)
        ? { variable, class: node.class }
        : undefined
    })
    const where = decodePolicyPattern(exists?.where)
    return nodes && where ? { exists: { nodes, where } } : undefined
  }
  const source = decodeTerm(record.source)
  const target = decodeTerm(record.target)
  if (!source || !target || !isIrSchemaRef(record.class)) return undefined
  const step: PolicyEdgeStep = { source, class: record.class, target }
  if (record.repeat !== undefined) {
    const repeat = asRecord(record.repeat)
    if (!isBoundedInt(repeat?.min) || !isBoundedInt(repeat?.max) || repeat.min > repeat.max) {
      return undefined
    }
    step.repeat = { min: repeat.min, max: repeat.max }
  }
  return step
}

const decodeRef = (value: unknown): IrSchemaRef | undefined =>
  isIrSchemaRef(value) ? value : undefined

export function decodePolicyExpression(value: unknown): PolicyExpression | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  if ('match' in record) {
    const match = decodePolicyPattern(record.match)
    return match && { match }
  }
  if ('allOf' in record) {
    const allOf = decodeList(record.allOf, decodeRef)
    return allOf && { allOf }
  }
  if ('anyOf' in record) {
    const anyOf = decodeList(record.anyOf, decodeRef)
    return anyOf && { anyOf }
  }
  return undefined
}

/** Decode one raw `SchemaIR.policies` entry; `origin` and `name` stand in for a missing ref. */
export function decodePolicy(origin: string, name: string, value: unknown): Policy | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const expression = decodePolicyExpression(record.expression)
  if (!expression) return undefined
  const ref: IrSchemaRef = isIrSchemaRef(record.ref) ? record.ref : { origin, kind: 'policy', name }
  return {
    ref,
    expression,
    ...(typeof record.description === 'string' && record.description
      ? { description: record.description }
      : {}),
  }
}

function decodeCheckObject(value: unknown): PolicyCheckObject | undefined {
  const record = asRecord(value)
  switch (record?.kind) {
    case 'self':
      return { kind: 'self' }
    case 'input':
      return typeof record.field === 'string' ? { kind: 'input', field: record.field } : undefined
    case 'ref':
      return isIrSchemaRef(record.ref) ? { kind: 'ref', ref: record.ref } : undefined
    default:
      return undefined
  }
}

/** Decode a callable's raw `policy` (the check expression bound to its objects). */
export function decodePolicyCheck(value: unknown): PolicyCheck | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  if ('allOf' in record) {
    const allOf = decodeList(record.allOf, decodePolicyCheck)
    return allOf && { allOf }
  }
  if ('anyOf' in record) {
    const anyOf = decodeList(record.anyOf, decodePolicyCheck)
    return anyOf && { anyOf }
  }
  const object = decodeCheckObject(record.object)
  return isIrSchemaRef(record.check) && object ? { check: record.check, object } : undefined
}

// ── reading ─────────────────────────────────────────────────────────────────

/** Every `check` a callable's policy expression bottoms out in, in source order. */
export function policyCheckLeaves(check: PolicyCheck): PolicyCheckLeaf[] {
  if ('allOf' in check) return check.allOf.flatMap(policyCheckLeaves)
  if ('anyOf' in check) return check.anyOf.flatMap(policyCheckLeaves)
  return [check]
}

export const isEdgeStep = (pattern: PolicyPattern): pattern is PolicyEdgeStep =>
  'source' in pattern && 'target' in pattern

/** The reserved terms a pattern mentions — what tells a node policy from an edge policy. */
export function patternTerms(pattern: PolicyPattern): Set<PolicyReservedTerm> {
  const found = new Set<PolicyReservedTerm>()
  const visit = (p: PolicyPattern) => {
    if ('allOf' in p) p.allOf.forEach(visit)
    else if ('anyOf' in p) p.anyOf.forEach(visit)
    else if ('exists' in p) visit(p.exists.where)
    else {
      for (const term of [p.source, p.target]) if (term.kind !== 'variable') found.add(term.kind)
    }
  }
  visit(pattern)
  return found
}

/** Every policy the domain declares, decoded, keyed by canonical ref key AND by local name. */
export interface PolicyIndex {
  origin: string
  /** in declaration order */
  policies: Policy[]
  /** raw entries the Studio could not read, by name */
  unsupported: string[]
  byKey: Map<string, Policy>
}

export function indexPolicies(ir: Pick<SchemaIR, 'domain' | 'policies'>): PolicyIndex {
  const policies: Policy[] = []
  const unsupported: string[] = []
  const byKey = new Map<string, Policy>()
  for (const [name, raw] of Object.entries(ir.policies ?? {})) {
    const policy = decodePolicy(ir.domain, name, raw)
    if (!policy) {
      unsupported.push(name)
      continue
    }
    policies.push(policy)
    byKey.set(schemaRefKey(policy.ref), policy)
  }
  return { origin: ir.domain, policies, unsupported, byKey }
}

/** Resolve a ref the way the canvas names things: a local name, else the full key. */
export function policyLabel(ref: IrSchemaRef, origin: string): string {
  return ref.origin === origin ? ref.name : schemaRefKey(ref)
}

/**
 * What a policy guards, following composed refs. A reference the index does not hold ends
 * that branch: an unknown policy cannot make a node policy an edge one.
 */
export function policyGuard(policy: Policy, index: PolicyIndex): PolicyGuard {
  const terms = new Set<PolicyReservedTerm>()
  const seen = new Set<string>()
  const visit = (p: Policy) => {
    const key = schemaRefKey(p.ref)
    if (seen.has(key)) return
    seen.add(key)
    if ('match' in p.expression) {
      for (const term of patternTerms(p.expression.match)) terms.add(term)
      return
    }
    const refs = 'allOf' in p.expression ? p.expression.allOf : p.expression.anyOf
    for (const ref of refs) {
      const target = index.byKey.get(schemaRefKey(ref))
      if (target) visit(target)
    }
  }
  visit(policy)
  if (terms.has('source') || terms.has('target')) return 'edge'
  return terms.has('object') ? 'object' : 'subject'
}

/** Where a policy is used in the schema — which classes it protects, which callables check it. */
export interface PolicyUsage {
  classes: { className: string; type: 'node' | 'edge'; operation: 'read' | 'traverse' }[]
  callables: {
    owner: string
    ownerKind: 'class' | 'function'
    name: string
    object: PolicyCheckObject
    /** the check is one branch of several, so passing it alone may not be enough */
    composed: boolean
  }[]
}

export function policyUsage(ir: SchemaIR, policy: Policy): PolicyUsage {
  const key = schemaRefKey(policy.ref)
  const usage: PolicyUsage = { classes: [], callables: [] }
  const collect = (owner: string, ownerKind: 'class' | 'function', name: string, raw: unknown) => {
    const check = raw === undefined ? undefined : decodePolicyCheck(raw)
    if (!check) return
    const leaves = policyCheckLeaves(check)
    for (const leaf of leaves) {
      if (schemaRefKey(leaf.check) !== key) continue
      usage.callables.push({
        owner,
        ownerKind,
        name,
        object: leaf.object,
        composed: leaves.length > 1,
      })
    }
  }
  for (const cls of Object.values(ir.classes)) {
    for (const [operation, ref] of Object.entries(cls.policies ?? {})) {
      if ((operation === 'read' || operation === 'traverse') && schemaRefKey(ref) === key) {
        usage.classes.push({ className: cls.name, type: cls.type, operation })
      }
    }
    for (const [name, method] of Object.entries(cls.methods)) {
      collect(cls.name, 'class', name, method.policy)
    }
  }
  for (const [name, fn] of Object.entries(ir.functions))
    collect(ir.domain, 'function', name, fn.policy)
  return usage
}
