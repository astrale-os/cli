import type { IrSchemaRef, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { definitionRefKey, isIrInterfaceRef } from '@shared/types'

import { type InterfaceTier, interfaceTier, resolveInterface } from '../inheritance'
import {
  type InterfaceDefinitionRef,
  type InterfaceReference,
  interfaceSelectionId,
  parseInterfaceSelectionToken,
} from '../modules'

export interface InterfaceRelation {
  name: string
  reference: InterfaceReference
  identity: string
  tier: InterfaceTier
  origin?: string
  selectionId: string
  navigable: boolean
}

export function selectedInterfaceRef(
  ir: SchemaIR,
  token: string,
): InterfaceDefinitionRef | undefined {
  const parsed = parseInterfaceSelectionToken(token)
  if (!parsed) return undefined
  if (parsed.origin === ir.domain) return ir.interfaces[parsed.name] ? parsed : undefined
  const key = definitionRefKey(parsed)
  const descriptor = ir.importsByKey?.[key]
  if (descriptor?.ref && isIrInterfaceRef(descriptor.ref)) return descriptor.ref
  const body = ir.importedInterfacesByKey?.[key]
  if (body?.ref && isIrInterfaceRef(body.ref)) return body.ref
  return body ? parsed : undefined
}

export function interfaceRelations(
  bundle: StudioSchemaBundle,
  refs: IrSchemaRef[] | undefined,
  legacyNames: string[] | undefined,
): InterfaceRelation[] {
  const references: InterfaceReference[] =
    refs !== undefined ? refs.filter(isIrInterfaceRef) : (legacyNames ?? [])
  return references.map((reference) => ({
    name: typeof reference === 'string' ? reference : reference.name,
    reference,
    identity: typeof reference === 'string' ? `legacy:${reference}` : definitionRefKey(reference),
    tier: interfaceTier(bundle, reference),
    origin:
      typeof reference === 'string'
        ? bundle.ir?.imports[reference]?.origin
        : reference.origin === bundle.ir?.domain
          ? undefined
          : reference.origin,
    selectionId: interfaceSelectionId(reference, bundle.ir?.domain),
    navigable: resolveInterface(bundle, reference) !== undefined,
  }))
}

// ── cardinality helpers (max:null = unbounded; undeclared ⇒ unconstrained = many) ──
export type Card = { min: number; max: number | null }
export function cardLabel(c?: Card): string {
  if (!c) return '*'
  const { min, max } = c
  if (max === null) return min <= 0 ? '*' : `${min}..*`
  if (min === max) return `${max}`
  return `${min}..${max}`
}
export const isMany = (c?: Card) => !c || c.max === null || c.max > 1
export const isOptional = (c?: Card) => !c || c.min <= 0

/** Short origin label for an imported interface's header chip ("kernel", "notifications"). */
export function originLabel(origin?: string): string {
  if (!origin) return 'imported'
  if (origin === 'kernel.astrale.ai') return 'kernel'
  return origin.split('.')[0]
}

export function splitId(id: string): ['interface' | 'class', string] {
  const [k, ...rest] = id.split('.')
  return [k === 'interface' ? 'interface' : 'class', rest.join('.')]
}
