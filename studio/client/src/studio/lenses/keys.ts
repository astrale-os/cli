/**
 * The questions the canvas answers about a Domain, as the lens switch names them. Kept
 * apart from the projectors so the top bar and the Studio's store can name a lens without
 * loading one; `available` says which lenses have a projector yet.
 */

export const LENS_KEYS = ['structure', 'behavior', 'rules'] as const

export type LensKey = (typeof LENS_KEYS)[number]

export interface LensName {
  id: LensKey
  label: string
  /** the question it answers */
  question: string
  /** its keyboard shortcut */
  shortcut: string
  available: boolean
  /** read at the Data level, where a dataset's identities answer it, before `available` */
  data?: boolean
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
    data: true,
  },
]

/** Whether `lens` can be chosen at a level: the Data level reads Rules before the Schema does. */
export const lensReadable = (lens: LensName, dataLevel: boolean) =>
  lens.available || (dataLevel && lens.data === true)
