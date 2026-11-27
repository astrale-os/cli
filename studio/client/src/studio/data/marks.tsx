/**
 * The Data level's marks. Wherever the Schema has a mark the Data level wears it: a Class its
 * icon in its module's hue (`ClassName`), an operation its glyph in its hue (`OP_GLYPHS`), a
 * rule whom it admits (`RuleMark`), a section what it lists (`SECTION_MARKS`). What the Schema
 * has no mark for is the dataset's own, and has its one home here: a verdict's outcome and a
 * Scenario step's standing, each a glyph in a tone of `canvas/tones.ts` — the one the Schema
 * gives what holds (`success`), what is refused (`delete`, as a restricting end refuses a
 * deletion) and what cannot be told (`warning`). The panel, the map's chips, the identity picker
 * and the Behavior panel read them from here.
 */

import type { CSSProperties } from 'react'

import {
  Ban,
  Boxes,
  Check,
  CircleQuestionMark,
  CircleSlash,
  CircleX,
  type LucideIcon,
  ScrollText,
  Variable,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import type { SectionMark } from '../inspector/marks'
import type { ClassLink } from '../inspector/structure'
import type { SceneTone } from '../scene/types'
import type { Outcome } from './access'
import type { DataClass, DataEdge } from './model'
import type { Standing } from './scenarios'

import { GLYPHS } from '../canvas/glyphs'
import { TONE_COLOR } from '../canvas/tones'
import { originShort } from '../lenses/structure'
import { OP_GLYPHS } from '../rules/rule-mark'

interface Mark {
  readonly glyph: LucideIcon
  readonly tone: SceneTone
  /** what it says, read by a screen reader before the sentence it marks */
  readonly word: string
}

/** A verdict's outcome: allowed, refused, or the rules can't tell. */
export const OUTCOME_MARKS: Record<Outcome, Mark & { readonly admits: string }> = {
  allowed: { glyph: Check, tone: 'success', word: 'Allowed', admits: 'Admitted' },
  refused: { glyph: Ban, tone: 'delete', word: 'Refused', admits: 'Not admitted' },
  unknown: { glyph: CircleQuestionMark, tone: 'warning', word: "Can't tell", admits: "Can't tell" },
}

/** A Scenario step's standing against what it expects. */
export const STANDING_MARKS: Record<Standing, Mark & { readonly plural: string }> = {
  expected: { glyph: Check, tone: 'success', word: 'As expected', plural: 'as expected' },
  unexpected: {
    glyph: CircleX,
    tone: 'delete',
    word: 'Not as expected',
    plural: 'not as expected',
  },
  gone: { glyph: CircleSlash, tone: 'delete', word: 'Gone', plural: 'gone' },
  unknown: { glyph: CircleQuestionMark, tone: 'warning', word: "Can't tell", plural: "can't tell" },
}

/**
 * The Data level's sections, each marked by what it lists as the map and the Index mark it: the
 * Classes and the Nodes their cards' glyph in the Class hue; an identity, and a verdict asked as
 * one, its key in the hue of a rule's caller; a traversal its operation's glyph and hue; the
 * Scenarios their glyph in the hue the Index gives one; a Policy's rule in the hue of a rule that
 * reads its caller. An outcome's section wears its outcome's mark (`OUTCOME_MARKS`), a step's
 * standing its own (`STANDING_MARKS`); a Schema section its kind (`SECTION_MARKS`).
 */
export const DATA_SECTIONS = {
  classes: { glyph: GLYPHS.class, tone: 'node' },
  nodes: { glyph: Boxes, tone: 'node' },
  identities: { glyph: GLYPHS.identity, tone: 'who' },
  asIdentity: { glyph: GLYPHS.identity, tone: 'who' },
  variables: { glyph: Variable, tone: 'muted' },
  traverse: { glyph: OP_GLYPHS.traverse, tone: 'traverse' },
  scenarios: { glyph: GLYPHS.scenario, tone: 'call' },
  rule: { glyph: ScrollText, tone: 'who' },
} as const satisfies Record<string, SectionMark>

/** A mark's glyph in its tone, its word for a screen reader; `title` read on hover. */
export function DataMark({
  mark,
  className,
  title,
  ...rest
}: {
  mark: Mark
  className?: string
  title?: string
} & Record<`data-${string}`, string | undefined>) {
  const Glyph = mark.glyph
  return (
    <span
      role="img"
      aria-label={mark.word}
      title={title ?? mark.word}
      className={cn('inline-flex shrink-0', className)}
      style={{ color: TONE_COLOR[mark.tone] } as CSSProperties}
      {...rest}
    >
      <Glyph aria-hidden className="h-full w-full" />
    </span>
  )
}

/** A Class of the dataset as the Schema's marks name it: its icon, its module's hue, its Domain. */
export function classLinkOf(cls: DataClass): ClassLink {
  return {
    target: cls.target,
    name: cls.name,
    ...(cls.local ? {} : { domain: originShort(cls.origin) }),
    open: cls.local,
    ...(cls.icon === undefined ? {} : { icon: cls.icon }),
    ...(cls.hue === undefined ? {} : { hue: cls.hue }),
  }
}

/** An Edge's relationship as the Schema's marks name it: the relationship's glyph and hue. */
export function relationshipLinkOf(edge: DataEdge): ClassLink {
  const key = edge.relationTarget.slice('class.'.length)
  const cut = key.indexOf(':class.')
  const local = cut < 0
  return {
    target: edge.relationTarget,
    name: edge.name,
    ...(local ? {} : { domain: originShort(key.slice(0, cut)) }),
    open: local,
    relationship: true,
  }
}
