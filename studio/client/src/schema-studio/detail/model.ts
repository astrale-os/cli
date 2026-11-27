import type { IrClassRef } from '@shared/schema/identity'

import { classRefKey } from '@shared/schema/identity'

type Card = { min: number; max: number | null }

export function cardLabel(card?: Card): string {
  if (!card) return '*'
  if (card.max === null) return card.min <= 0 ? '*' : `${card.min}..*`
  return card.min === card.max ? `${card.max}` : `${card.min}..${card.max}`
}

export function originLabel(origin?: string): string {
  if (!origin) return 'this domain'
  if (origin === 'kernel.astrale.ai') return 'kernel'
  return origin.split('.')[0]
}

/** The selection id that opens a Class: its bare name at home, its exact key when imported. */
export function classSelectionId(ref: IrClassRef, domain: string | undefined): string {
  return ref.origin === domain ? `class.${ref.name}` : `class.${classRefKey(ref)}`
}
