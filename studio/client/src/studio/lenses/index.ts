/**
 * The lens registry. A lens is a projector and its options; the canvas, the Index and the
 * Inspector need nothing else, so a new lens is one projector, one entry here, and its
 * name marked available in `keys.ts`.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import type { LensOption, LensOptions, Projector } from '../scene/types'

import { BEHAVIOR_OPTIONS, behaviorFocus, projectBehavior } from './behavior'
import { type LensKey, type LensName, LENS_NAMES } from './keys'
import { projectRules, RULES_OPTIONS, rulesFocus } from './rules'
import { projectStructure, STRUCTURE_OPTIONS } from './structure'

/**
 * What of a selection changes what a lens draws: the projector's focus, or nothing. A
 * selection without one only lights the scene, so selecting never re-lays it out.
 */
export type LensFocus = (
  bundle: StudioSchemaBundle,
  options: LensOptions,
  selected: string | undefined,
) => string | undefined

interface Projection {
  project: Projector
  options: readonly LensOption[]
  focus?: LensFocus
}

export interface Lens extends LensName, Partial<Projection> {
  options: readonly LensOption[]
}

const PROJECTORS: Partial<Record<LensKey, Projection>> = {
  structure: { project: projectStructure, options: STRUCTURE_OPTIONS },
  behavior: { project: projectBehavior, options: BEHAVIOR_OPTIONS, focus: behaviorFocus },
  rules: { project: projectRules, options: RULES_OPTIONS, focus: rulesFocus },
}

export const LENSES: readonly Lens[] = LENS_NAMES.map((name) => ({
  ...name,
  ...(PROJECTORS[name.id] ?? { options: [] }),
}))

export function lensOf(id: LensKey): Lens {
  return LENSES.find((lens) => lens.id === id) ?? LENSES[0]!
}

/** A lens's options as set, each one at its default until changed. */
export function optionsOf(lens: Lens, set: Readonly<Record<string, boolean>> | undefined) {
  return Object.fromEntries(
    lens.options.map((option) => [option.id, set?.[option.id] ?? option.default]),
  )
}
