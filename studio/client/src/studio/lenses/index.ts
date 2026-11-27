/**
 * The lens registry. A lens is a projector and its options; the canvas, the Index and the
 * Inspector need nothing else, so a new lens is one projector, one entry here, and its
 * name marked available in `keys.ts`.
 */

import type { DomainAnatomy, StudioSchemaBundle } from '@shared/contracts/schema'

import type { LensOption, LensOptions, Projector, Scene } from '../scene/types'

import { BEHAVIOR_OPTIONS, behaviorFocus, projectBehavior } from './behavior'
import { type LensId, type LensName, LENS_NAMES } from './keys'
import { projectRules, RULES_OPTIONS, rulesFocus } from './rules'
import {
  composeStructure,
  NO_COMPOSITION,
  projectStructure,
  STRUCTURE_OPTIONS,
  type StructureComposition,
} from './structure'
import { projectViews, VIEWS_OPTIONS } from './views'

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
  /** For the lens that draws other Domains beside the open one: how it draws them. */
  compose?: (
    bundle: StudioSchemaBundle,
    options: LensOptions,
    composition: StructureComposition,
  ) => Scene
}

export interface Lens extends LensName, Partial<Projection> {
  options: readonly LensOption[]
}

const PROJECTORS: Partial<Record<LensId, Projection>> = {
  structure: { project: projectStructure, compose: composeStructure, options: STRUCTURE_OPTIONS },
  behavior: { project: projectBehavior, options: BEHAVIOR_OPTIONS, focus: behaviorFocus },
  rules: { project: projectRules, options: RULES_OPTIONS, focus: rulesFocus },
  views: { project: projectViews, options: VIEWS_OPTIONS },
}

export const LENSES: readonly Lens[] = LENS_NAMES.map((name) => ({
  ...name,
  ...(PROJECTORS[name.id] ?? { options: [] }),
}))

export function lensOf(id: LensId): Lens {
  return LENSES.find((lens) => lens.id === id) ?? LENSES[0]!
}

/** A lens's options as set, each one at its default until changed. */
export function optionsOf(lens: Lens, set: Readonly<Record<string, boolean>> | undefined) {
  return Object.fromEntries(
    lens.options.map((option) => [option.id, set?.[option.id] ?? option.default]),
  )
}

/**
 * A lens's Scene of the open Domain. A lens that draws other Domains draws them as
 * `composition` says; every other lens reads the open Domain alone, so no composition reaches
 * its Scene.
 */
export function sceneOf(
  lens: Lens,
  bundle: StudioSchemaBundle,
  options: LensOptions,
  focus?: string,
  anatomy?: DomainAnatomy,
  composition: StructureComposition = NO_COMPOSITION,
): Scene | undefined {
  if (lens.compose) return lens.compose(bundle, options, composition)
  return lens.project?.(bundle, options, focus, anatomy)
}
