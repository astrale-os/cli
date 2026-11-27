/**
 * A verdict's parts as every Data panel reads them: the operation it decides and whom the rule
 * there admits, marked as the Schema's rules mark them, then by which rule and why; and the
 * Edges that prove it, each wearing the number its walk gives it once the walk is staged.
 */

import type { FactId } from '@astrale-os/visual'
import type { CSSProperties } from 'react'

import { ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { SceneTone } from '../scene/types'
import type { PathStep, Slot } from './access'
import type { VerdictView } from './verdict-view'

import { TONE_COLOR, TONE_TEXT } from '../canvas/tones'
import { Link, Meta } from '../inspector/parts'
import { RuleMark } from '../rules/rule-mark'
import '../stage/stage.css'

/** The word each operation a verdict decides is said by, as the Schema's rules say it. */
const OP_WORD: Record<Slot, string> = { read: 'Read', traverse: 'Traverse', call: 'Call' }

/** `Read · By Policy OwnService. Its condition holds through the Edges below.`, marked. */
export function VerdictBy({
  view,
  domainId,
  className,
}: {
  view: VerdictView
  domainId: string
  className?: string
}) {
  return (
    <Meta className={className}>
      <span
        data-verdict-op={view.op}
        className={cn(
          'mr-1.5 inline-flex items-center gap-1 align-[-0.2em] font-medium',
          TONE_TEXT[view.op],
        )}
      >
        {view.admits && <RuleMark mark={view.admits} />}
        {OP_WORD[view.op]}
      </span>
      By{' '}
      {view.policies.length > 0 ? (
        <>
          {view.policies.length === 1 ? 'Policy ' : 'Policies '}
          {view.policies.map((policy, index) => (
            <span key={policy.name}>
              {index > 0 && ', '}
              <Link target={policy.target} domainId={domainId} mono>
                {policy.name}
              </Link>
            </span>
          ))}
        </>
      ) : (
        view.by
      )}
      . {view.why}
    </Meta>
  )
}

/**
 * The Edges that prove a verdict, each in words: each wears the number its walk gives it on the
 * stage and the map when the walk is staged (`numbers`), in the hue of what is decided; else an
 * arrow in that hue.
 */
export function PathList({
  path,
  numbers,
  tone,
  className,
  ...rest
}: {
  path: readonly PathStep[]
  numbers?: ReadonlyMap<FactId, number>
  tone: SceneTone
  className?: string
} & Record<`data-${string}`, string | undefined>) {
  if (path.length === 0) return null
  return (
    <ul
      className={cn('space-y-0.5 text-[12px] text-foreground/90', className)}
      style={{ '--step-tone': TONE_COLOR[tone] } as CSSProperties}
      {...rest}
    >
      {path.map((step) => {
        const number = numbers?.get(step.edge)
        return (
          <li
            key={step.edge}
            data-path-edge={step.edge}
            data-path-step={number}
            className="flex items-center gap-1.5"
          >
            {number !== undefined ? (
              <span className="stage-step">{number}</span>
            ) : (
              <ArrowRight aria-hidden className={cn('h-3 w-3 shrink-0', TONE_TEXT[tone])} />
            )}
            {step.words}
          </li>
        )
      })}
    </ul>
  )
}
