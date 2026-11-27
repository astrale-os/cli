/**
 * The marks a rule is read by, drawn the same on a card's row, in the Index and in the Inspector.
 *
 * A rule's mark says whom it admits: its glyph and its tone are the admission's own
 * (`ADMISSION_GLYPHS`, `ADMISSION_TONES`), filled where the Schema or a contract writes it, a
 * dashed ring in the muted tone where the Kernel's default applies. Beside a label it is an
 * `Admission`: the mark, then whom it admits in the same tone. The operation a rule decides is
 * said apart from it, by its own mark (`OpMark`): the operation's glyph in its hue, never filled.
 */

import type { CSSProperties, ReactNode } from 'react'

import {
  CircleQuestionMark,
  Eye,
  Footprints,
  Globe,
  KeyRound,
  ListChecks,
  Lock,
  type LucideIcon,
  PencilLine,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  Workflow,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import type { RuleAdmission, RuleOp, SceneRuleMark } from '../scene/types'

import { TONE_COLOR } from '../canvas/tones'
import { admissionLabel, markWords } from './admission'
import './rule-mark.css'

/** The glyph each admission wears: a Policy's shield, the world, a signed-in caller, a key, shut. */
export const ADMISSION_GLYPHS: Record<RuleAdmission, LucideIcon> = {
  policy: ShieldCheck,
  open: Globe,
  'signed-in': UserCheck,
  holders: KeyRound,
  closed: Lock,
  unread: CircleQuestionMark,
}

/** The tone each admission wears where it is written; the Kernel's default reads muted. */
export const ADMISSION_TONES: Record<RuleAdmission, string> = {
  policy: 'var(--color-admit-policy)',
  open: 'var(--color-admit-open)',
  'signed-in': 'var(--color-admit-signed-in)',
  holders: 'var(--color-muted-foreground)',
  closed: 'var(--color-admit-closed)',
  unread: 'var(--color-muted-foreground)',
}

const toneOf = (mark: SceneRuleMark) =>
  mark.unwritten ? 'var(--color-muted-foreground)' : ADMISSION_TONES[mark.admits]

export function RuleMark({
  mark,
  className,
  title,
}: {
  mark: SceneRuleMark
  className?: string
  /** what it says on hover; its own words when left out */
  title?: string | null
}) {
  const Glyph = ADMISSION_GLYPHS[mark.admits]
  const words = markWords(mark)
  return (
    <span
      className={cn('rule-mark', className)}
      data-rule-mark={mark.admits}
      data-rule-op={mark.op}
      data-unwritten={mark.unwritten || undefined}
      role="img"
      aria-label={words}
      title={title === null ? undefined : (title ?? words)}
      style={{ '--mark-tone': toneOf(mark) } as CSSProperties}
    >
      <Glyph aria-hidden />
    </span>
  )
}

/** Several marks side by side: a fold's, each different one once. */
export function RuleMarks({
  marks,
  className,
}: {
  marks: readonly SceneRuleMark[]
  className?: string
}) {
  if (marks.length === 0) return null
  return (
    <span className={cn('rule-marks', className)} data-rule-marks={marks.length}>
      {marks.map((mark) => (
        <RuleMark key={`${mark.op}|${mark.admits}|${mark.unwritten === true}`} mark={mark} />
      ))}
    </span>
  )
}

/**
 * A mark and whom it admits, in its tone: `Any signed-in caller`; where nothing is written,
 * `Kernel default` before it. What an entry of the Inspector leads with.
 */
export function Admission({
  mark,
  className,
  title,
  children,
}: {
  mark: SceneRuleMark
  className?: string
  /** the sentence it stands for, on hover */
  title?: string
  /** said after it, quieter: why it admits them (`by its contract`) */
  children?: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn('admission', className)}
      data-admission={mark.admits}
      data-unwritten={mark.unwritten || undefined}
      style={{ '--mark-tone': toneOf(mark) } as CSSProperties}
    >
      <RuleMark mark={mark} title={null} />
      {mark.unwritten && mark.admits !== 'unread' && (
        <span className="admission-default">Kernel default</span>
      )}
      <span className="admission-label">{admissionLabel(mark.admits)}</span>
      {children !== undefined && <span className="admission-why">{children}</span>}
    </span>
  )
}

/** The glyph each operation wears: what it does to a Node, an Edge or a function. */
export const OP_GLYPHS: Record<RuleOp, LucideIcon> = {
  read: Eye,
  traverse: Footprints,
  create: Plus,
  update: PencilLine,
  delete: Trash2,
  call: Workflow,
}

/** The operations a Policy decides, each its glyph in its hue: what the Index reads at its end. */
export function OpMarks({ ops, className }: { ops: readonly RuleOp[]; className?: string }) {
  if (ops.length === 0) return null
  return (
    <span className={cn('rule-marks', className)} data-rule-ops={ops.join(' ')}>
      {ops.map((op) => {
        const Glyph = OP_GLYPHS[op]
        return (
          <span
            key={op}
            className="op-mark"
            data-op-mark={op}
            role="img"
            aria-label={op}
            title={op}
            style={{ '--mark-tone': TONE_COLOR[op] } as CSSProperties}
          >
            <Glyph aria-hidden />
          </span>
        )
      })}
    </span>
  )
}

/** A constraint's mark, in its own hue. */
export function ConstraintMark({ className }: { className?: string }) {
  return (
    <span
      className={cn('rule-mark', className)}
      data-rule-mark="constraint"
      aria-hidden
      style={{ '--mark-tone': TONE_COLOR.what } as CSSProperties}
    >
      <ListChecks aria-hidden />
    </span>
  )
}
