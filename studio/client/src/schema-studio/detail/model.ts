import type { IrClass, IrClassRef, IrMethod, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { classRefKey } from '@shared/types'

import { type ClassTier, inheritedGroupsOfClass } from '../inheritance'

export type Card = { min: number; max: number | null }

export function cardLabel(card?: Card): string {
  if (!card) return '*'
  if (card.max === null) return card.min <= 0 ? '*' : `${card.min}..*`
  return card.min === card.max ? `${card.max}` : `${card.min}..${card.max}`
}

export const isMany = (card?: Card): boolean => !card || card.max === null || card.max > 1
export const isOptional = (card?: Card): boolean => !card || card.min <= 0

export function originLabel(origin?: string): string {
  if (!origin) return 'this domain'
  if (origin === 'kernel.astrale.ai') return 'kernel'
  return origin.split('.')[0]
}

export function selectedClassName(id: string): string {
  return id.startsWith('class.') ? id.slice('class.'.length) : id
}

/** Where an inherited member comes from — enough to prefix it and to anchor it. */
export interface MemberOwner {
  name: string
  ref: IrClassRef
  tier: ClassTier
  origin?: string
  /** the anchor namespace the member is commented under: its declaring Class's */
  refBase: string
  /** a local base Class has handler links to read; an imported one does not */
  local: boolean
}

export interface PropertyEntry {
  name: string
  schema: JsonSchema
  optional: boolean
  owner?: MemberOwner
}

export interface MethodEntry {
  name: string
  method: IrMethod
  declaredLocally: boolean
  owner?: MemberOwner
}

/**
 * One list per member kind, the Class's own declarations first and everything it
 * inherits after them — base by base, nearest first — each inherited entry carrying
 * the Class it comes from. Reading down the list answers "what does this Class have"
 * before "where did it get it".
 */
export function memberLists(
  bundle: StudioSchemaBundle,
  className: string,
  member: IrClass,
  withInherited: boolean,
): { properties: PropertyEntry[]; methods: MethodEntry[] } {
  const required = new Set(member.required ?? [])
  const properties: PropertyEntry[] = Object.entries(member.properties).map(([name, schema]) => ({
    name,
    schema,
    optional: !required.has(name),
  }))
  const methods: MethodEntry[] = Object.entries(member.methods).map(([name, method]) => ({
    name,
    method,
    declaredLocally: false,
  }))
  if (!withInherited) return { properties, methods }

  for (const group of inheritedGroupsOfClass(bundle, className)) {
    const local = group.ref.origin === bundle.ir?.domain
    const owner: MemberOwner = {
      name: group.owner,
      ref: group.ref,
      tier: group.tier,
      ...(group.origin === undefined ? {} : { origin: group.origin }),
      refBase: local ? `class.${group.owner}` : `class.${classRefKey(group.ref)}`,
      local,
    }
    for (const [name, schema, optional] of group.props) {
      properties.push({ name, schema, optional, owner })
    }
    for (const { name, method, declaredLocally } of group.methods) {
      methods.push({ name, method, declaredLocally, owner })
    }
  }
  return { properties, methods }
}
