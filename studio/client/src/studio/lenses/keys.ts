/**
 * The questions the canvas answers about a Domain's Schema, as the lens switch names them; a
 * dataset is read through tabs of its own (`data/tabs.ts`). Kept
 * apart from the projectors so the top bar and the Studio's store can name a lens without
 * loading one; `available` says which lenses have a projector yet.
 */

export const LENS_KEYS = ['structure', 'behavior', 'rules', 'views'] as const

/** A lens the switch names. */
export type LensId = (typeof LENS_KEYS)[number]

/** A lens that reads a Class, a function or a rule: the ones a selection is carried between. */
export type LensKey = Exclude<LensId, 'views'>

export interface LensName {
  id: LensId
  label: string
  /** the question it answers */
  question: string
  /** its keyboard shortcut */
  shortcut: string
  available: boolean
}

export const LENS_NAMES: readonly LensName[] = [
  { id: 'structure', label: 'Structure', question: 'What exists', shortcut: '1', available: true },
  { id: 'behavior', label: 'Behavior', question: 'What happens', shortcut: '2', available: true },
  {
    id: 'rules',
    label: 'Rules',
    question: 'What is allowed and what constraints hold',
    shortcut: '3',
    available: true,
  },
  { id: 'views', label: 'Views', question: 'What people see', shortcut: '4', available: true },
]

export const lensName = (id: LensId): LensName => LENS_NAMES.find((lens) => lens.id === id)!

export const isLensId = (value: string | null | undefined): value is LensId =>
  value !== null && value !== undefined && (LENS_KEYS as readonly string[]).includes(value)
