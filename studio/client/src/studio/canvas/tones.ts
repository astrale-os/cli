/**
 * The hue each Scene tone wears, in every form the Studio draws it: a colour for a mark or a
 * line, a text class, and a chip's background and text. One table per form, every tone in
 * each, so a kind, a verb or a rule reads alike on the canvas, in the Index and in a panel.
 */

import type { SceneTone } from '../scene/types'

/** The tone as a colour: a card's mark, a tally's dot, a sign. */
export const TONE_COLOR: Record<SceneTone, string> = {
  node: 'var(--color-schema-node)',
  edge: 'var(--color-schema-edge)',
  view: 'var(--color-schema-view)',
  core: 'var(--color-schema-core)',
  fn: 'var(--color-schema-function)',
  muted: 'var(--color-muted-foreground)',
  create: 'var(--color-verb-create)',
  update: 'var(--color-verb-update)',
  delete: 'var(--color-verb-delete)',
  transition: 'var(--color-verb-transition)',
  link: 'var(--color-verb-link)',
  unlink: 'var(--color-verb-unlink)',
  call: 'var(--color-verb-call)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  who: 'var(--color-rule-who)',
  what: 'var(--color-rule-what)',
  read: 'var(--op-read)',
  traverse: 'var(--op-traverse)',
}

/** The tone as text: a glyph in the Index, a verb in a sentence. */
export const TONE_TEXT: Record<SceneTone, string> = {
  node: 'text-schema-node',
  edge: 'text-schema-edge',
  view: 'text-schema-view',
  core: 'text-schema-core',
  fn: 'text-schema-function',
  muted: 'text-muted-foreground',
  create: 'text-verb-create',
  update: 'text-verb-update',
  delete: 'text-verb-delete',
  transition: 'text-verb-transition',
  link: 'text-verb-link',
  unlink: 'text-verb-unlink',
  call: 'text-verb-call',
  warning: 'text-warning',
  success: 'text-success',
  who: 'text-rule-who',
  what: 'text-rule-what',
  read: 'text-(--op-read)',
  traverse: 'text-(--op-traverse)',
}

/** The tone as a chip: a faint wash of the hue behind text in it. */
export const TONE_CHIP: Record<SceneTone, string> = {
  node: 'bg-schema-node/10 text-schema-node',
  edge: 'bg-schema-edge/12 text-schema-edge',
  view: 'bg-schema-view/10 text-schema-view',
  core: 'bg-schema-core/10 text-schema-core',
  fn: 'bg-schema-function/10 text-schema-function',
  muted: 'bg-muted text-muted-foreground',
  create: 'bg-verb-create/10 text-verb-create',
  update: 'bg-verb-update/10 text-verb-update',
  delete: 'bg-verb-delete/10 text-verb-delete',
  transition: 'bg-verb-transition/10 text-verb-transition',
  link: 'bg-verb-link/10 text-verb-link',
  unlink: 'bg-verb-unlink/10 text-verb-unlink',
  call: 'bg-verb-call/10 text-verb-call',
  warning: 'bg-warning/12 text-warning',
  success: 'bg-success/12 text-success',
  who: 'bg-rule-who/10 text-rule-who',
  what: 'bg-rule-what/10 text-rule-what',
  read: 'bg-(--op-read)/10 text-(--op-read)',
  traverse: 'bg-(--op-traverse)/10 text-(--op-traverse)',
}
