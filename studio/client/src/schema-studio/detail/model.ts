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
