/**
 * How a line reads against the focus, and whether its name is drawn: one rule for every line
 * the canvas draws and every name it places, in every lens and level (Structure, Behavior,
 * Rules, the Workspace map, Data).
 *
 * A line — a scene link, or the trunk several travel in — is lit when the focus lights it or
 * the pointer draws it as if lit; beside a focus, every other line is dimmed; with no focus,
 * it is at rest. A name is drawn only on a line that reads in full: never on a dimmed line, and
 * never on a hub's faint line (`ambient`) until it is lit. A name on a line drawn faint would
 * float over the cards the focus leaves lit, naming nothing the eye can follow; and a name
 * not drawn takes no room from one that is.
 */

import type { Arrangement } from '../scene/arrange'
import type { Neighbourhood } from '../scene/focus'
import type { Scene } from '../scene/types'

const NONE: ReadonlySet<string> = new Set()

/** How a box or a line reads against the current focus. */
export type Emphasis = 'rest' | 'lit' | 'dim'

/** What a line reads against. */
export interface LineFocus {
  /** what the focus lights, or none */
  readonly lit: Neighbourhood | null
  /** the lines the pointer draws as if lit (in a Scene of ribbons, those it opens) */
  readonly asLit: ReadonlySet<string>
  /** the lines drawn faint at rest (`faintLines`) */
  readonly faint: ReadonlySet<string>
}

/** The focus of a canvas where nothing is lit, nor under the pointer. */
export function atRest(faint: ReadonlySet<string>): LineFocus {
  return { lit: null, asLit: NONE, faint }
}

/** How the line `id` reads: lit, dimmed beside the focus, or at rest. */
export function lineEmphasis(id: string, focus: LineFocus): Emphasis {
  const { lit, asLit } = focus
  if (lit?.links.has(id) || lit?.trunks.has(id) || asLit.has(id)) return 'lit'
  return lit ? 'dim' : 'rest'
}

/** Whether the line `id` says its name: when it is lit, or at rest unless it is drawn faint. */
export function nameDrawn(id: string, focus: LineFocus): boolean {
  const emphasis = lineEmphasis(id, focus)
  return emphasis === 'lit' || (emphasis === 'rest' && !focus.faint.has(id))
}

/** The lines drawn faint at rest: links that reach a hub, and trunks of nothing else. */
export function faintLines(scene: Scene, arrangement: Arrangement): Set<string> {
  const faint = new Set(scene.links.flatMap((link) => (link.ambient ? [link.id] : [])))
  for (const trunk of arrangement.trunks)
    if (trunk.links.length > 0 && trunk.links.every((id) => faint.has(id))) faint.add(trunk.id)
  return faint
}
