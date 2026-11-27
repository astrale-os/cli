/**
 * The questions the canvas answers about a Domain, as the lens switch names them. Kept
 * apart from the projectors so the top bar and the Studio's store can name a lens without
 * loading one; `available` says which lenses have a projector yet.
 */

export const LENS_KEYS = ['structure', 'behavior', 'rules', 'views'] as const

/** A lens the switch names. */
export type LensId = (typeof LENS_KEYS)[number]

/** A lens the Data level reads too: every lens but those only a Schema answers (`schemaOnly`). */
export type LensKey = Exclude<LensId, 'views'>

export interface LensName {
  id: LensId
  label: string
  /** the question it answers */
  question: string
  /** its keyboard shortcut */
  shortcut: string
  available: boolean
  /** read at the Data level, where a dataset's identities answer it, before `available` */
  data?: boolean
  /** why the Data level does not read it, for a lens only the Schema level answers */
  schemaOnly?: string
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
  {
    id: 'views',
    label: 'Views',
    question: 'What people see',
    shortcut: '4',
    available: true,
    schemaOnly:
      'A View renders on an instance, not over a Dataset yet: read Views at the Schema level.',
  },
]

export const lensName = (id: LensId): LensName => LENS_NAMES.find((lens) => lens.id === id)!

/**
 * Whether `lens` can be chosen at a level: the Data level reads Rules before the Schema does,
 * and never a lens only the Schema answers.
 */
export const lensReadable = (lens: LensName, dataLevel: boolean) =>
  dataLevel
    ? lens.schemaOnly === undefined && (lens.available || lens.data === true)
    : lens.available

export const isLensId = (value: string | null | undefined): value is LensId =>
  value !== null && value !== undefined && (LENS_KEYS as readonly string[]).includes(value)

/** Whether the Data level reads `lens`. */
export const isDataLens = (lens: LensId): lens is LensKey => lensName(lens).schemaOnly === undefined

/** The lens the Data level reads for `lens`: itself, or Structure for a lens only the Schema answers. */
export const dataLensOf = (lens: LensId): LensKey => (isDataLens(lens) ? lens : 'structure')
