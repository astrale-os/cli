/**
 * What a function or a definition does, one line per thing, as every panel reads it: the
 * Inspector's Behavior lens for a handler's mutations, and the Data level for what a
 * Scenario's call is declared to write. A change opens with its verb in the verb's tone; a
 * read is said quieter; what reads alike is told apart after it. A precondition opens with the
 * mark of what it requires, then its parts as the source writes them.
 */

import { type ReactNode, useState } from 'react'

import { cn } from '@/lib/utils'

import type { ClassLink, Phrase } from './structure'

import { TONE_TEXT } from '../canvas/tones'
import {
  type ChangeVerb,
  conditionWords,
  type DeletionMeets,
  type PreconditionLine,
} from './behavior'
import { DeletionMark, PreconditionMark } from './marks'
import { CallableName, ClassName, Joined, Meta, Phrases } from './parts'

/** One thing done, in words. */
export interface EffectRow {
  /** what it is, as `data-effect` says it: a verb, `expect`, `read` */
  readonly kind: string
  /** the change it makes: the first word of `words` is the verb's, read in its tone */
  readonly verb?: ChangeVerb
  /** `creates an Operation`, `expects no such Host` */
  readonly words: readonly Phrase[]
  /** what tells it from a change alike, after a dot: the relationships it writes, by name */
  readonly names?: readonly (ClassLink | string)[]
  /** after the names, quieter still: a state move, `accepted → succeeded` */
  readonly aside?: string
  /** read on hover: where the source says it */
  readonly where?: string
  /** read under it, quieter: where it lands */
  readonly note?: ReactNode
  /** a Node deletion's links, by what becomes of them, a line each under it */
  readonly deletion?: readonly DeletionMeets[]
}

const QUIET = new Set(['expect', 'read'])

export function Effects({
  effects,
  gaps,
  domainId,
  empty = 'No effect is read.',
  limit,
  more = (count) => `${count} more`,
}: {
  effects: readonly EffectRow[]
  /** why the reading cannot tell the rest */
  gaps: readonly string[]
  domainId: string
  /** said when it does nothing and nothing is left untold */
  empty?: string
  /** the rows shown before a fold that says how many it holds; all when none */
  limit?: number
  /** the fold's words for what it holds */
  more?: (count: number) => string
}) {
  const [open, setOpen] = useState(false)
  // a fold that would hide a single row hides nothing worth a click
  const shown =
    open || limit === undefined || effects.length <= limit + 1 ? effects : effects.slice(0, limit)
  const hidden = effects.length - shown.length
  return (
    <>
      {effects.length > 0 ? (
        <ol className="space-y-0.5 border-l border-border/70 pl-3 text-[13px] leading-relaxed">
          {shown.map((effect, index) => (
            <li
              key={index}
              data-effect={effect.kind}
              title={effect.where}
              className={QUIET.has(effect.kind) ? 'text-muted-foreground' : undefined}
            >
              <Spoken effect={effect} domainId={domainId} />
              {effect.names !== undefined && effect.names.length > 0 && (
                <span className="text-[12px] text-muted-foreground">
                  {' · '}
                  {effect.names.map((name, at) => (
                    <span key={at}>
                      {at > 0 && ', '}
                      {typeof name === 'string' ? (
                        <span className="font-mono">{name}</span>
                      ) : (
                        <ClassName link={name} domainId={domainId} mono />
                      )}
                    </span>
                  ))}
                </span>
              )}
              {effect.aside !== undefined && (
                <span className="text-[12px] text-muted-foreground"> · {effect.aside}</span>
              )}
              {effect.note !== undefined && (
                <span className="block text-[12px] text-muted-foreground">{effect.note}</span>
              )}
              {effect.deletion?.map((meets) => (
                <Meets key={meetsKey(meets)} meets={meets} domainId={domainId} />
              ))}
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                data-effects-fold={hidden}
                onClick={() => setOpen(true)}
                className="rounded-sm text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {more(hidden)}
              </button>
            </li>
          )}
        </ol>
      ) : gaps.length === 0 ? (
        <Meta>{empty}</Meta>
      ) : null}
      {gaps.length > 0 && <Meta>Can’t tell: {gaps.join('; ')}</Meta>}
    </>
  )
}

/** What deleting a Node does to some of its links, as the Kernel's lifetimes say, in words. */
export const MEETS_WORDS = {
  refused: {
    lead: 'refused while it has',
    title:
      'These links restrict: deleting the Node is refused while it has one, and nothing the mutation does deletes them.',
  },
  untold: {
    lead: 'can’t tell whether it unlinks',
    title:
      'These links restrict, and the reading cannot follow all the mutation does: the deletion is refused while one stands.',
  },
  detached: {
    lead: 'detaches',
    title: 'These links detach: the Kernel deletes them with the Node.',
  },
} as const

/**
 * The links a deleting mutation unlinks itself, in words: its own write, its verb in the unlink
 * hue, said with how many relationships it covers and why it matters, by the lifetime the links
 * would have had were they left.
 */
export const UNLINKS_WORDS = {
  restrict: {
    lead: 'it first from',
    said: 'that would refuse the delete',
    title:
      'These links restrict: the Kernel refuses to delete a Node that still has one, unless the same change deletes it. The mutation deletes them itself, so they do not stop the deletion.',
  },
  detach: {
    lead: 'it from',
    said: 'that would detach anyway',
    title:
      'These links detach: the Kernel would delete them with the Node. The mutation deletes them itself.',
  },
} as const

/** A deletion's line of links, told from the others under the same deletion. */
export const meetsKey = (meets: DeletionMeets): string =>
  meets.outcome === 'unlinked' ? `unlinked ${meets.lifetime}` : meets.outcome

/** One outcome of a deletion's links: its mark, its words, the relationships. */
export function Meets({ meets, domainId }: { meets: DeletionMeets; domainId: string }) {
  const names = (
    <Joined
      items={meets.relationships.map((link) => (
        <ClassName key={link.target} link={link} domainId={domainId} mono glyph={false} />
      ))}
    />
  )
  const line = (title: string, said: ReactNode) => (
    <span
      data-deletion-outcome={meets.outcome}
      data-deletion-lifetime={meets.outcome === 'unlinked' ? meets.lifetime : undefined}
      title={title}
      className="flex items-baseline gap-1.5 pl-3 text-[12px] leading-relaxed text-muted-foreground"
    >
      <DeletionMark outcome={meets.outcome} className="translate-y-[2px]" />
      <span>{said}</span>
    </span>
  )
  if (meets.outcome !== 'unlinked') {
    const words = MEETS_WORDS[meets.outcome]
    return line(
      words.title,
      <>
        {words.lead} {names}
      </>,
    )
  }
  const words = UNLINKS_WORDS[meets.lifetime]
  const count = meets.relationships.length
  return line(
    words.title,
    <>
      <span className={cn('font-medium', TONE_TEXT.unlink)}>unlinks</span> {words.lead} {count}{' '}
      {count === 1 ? 'relationship' : 'relationships'} {words.said}: {names}
    </>,
  )
}

/** Its words, the verb's own in the verb's tone. */
function Spoken({ effect, domainId }: { effect: EffectRow; domainId: string }) {
  const [first, ...rest] = effect.words
  if (effect.verb === undefined || typeof first !== 'string')
    return <Phrases phrases={effect.words} domainId={domainId} />
  const cut = first.indexOf(' ')
  const verb = cut < 0 ? first : first.slice(0, cut)
  return (
    <>
      <span className={cn('font-medium', TONE_TEXT[effect.verb])} data-effect-verb={effect.verb}>
        {verb}
      </span>
      {cut < 0 ? null : <span>{first.slice(cut)}</span>}
      <Phrases phrases={rest} domainId={domainId} />
    </>
  )
}

/**
 * What a precondition's kind requires, said of the Classes it names: what it requires of them is
 * in its parts, as written, never said again in other words.
 */
function Requires({ stated, domainId }: { stated: PreconditionLine; domainId: string }) {
  const classes =
    stated.classes.length === 0 ? undefined : (
      <Joined
        last="or"
        items={stated.classes.map((link) => (
          <ClassName key={link.target} link={link} domainId={domainId} />
        ))}
      />
    )
  switch (stated.kind) {
    case 'node':
      return <>The {classes ?? 'Node'} exists</>
    case 'edge':
      return <>The {classes ? <>{classes} Edge</> : 'Edge'} exists</>
    case 'none':
      return <>No {classes ?? 'Node'} matches</>
    case 'exists':
      return <>At least one {classes ?? 'Node'} matches</>
    case 'count':
      return <>The number of {classes ?? 'Node'} matches is within its bounds</>
    case 'unchanged':
      return <>The {classes ?? 'Node'} matches are exactly those given, in order</>
    case 'query':
      return <>The Query{classes && <> on {classes}</>} answers what is given</>
  }
}

/**
 * The preconditions mutations state, a line each: the mark of what it requires and the Classes it
 * names, its parts as the source writes them, the name a refusal carries, and what the reading
 * cannot tell. Where several mutations are read, each line names those that state it.
 */
export function Preconditions({
  preconditions,
  domainId,
  mutations = false,
}: {
  preconditions: readonly PreconditionLine[]
  domainId: string
  /** whether each line names the mutations that state it */
  mutations?: boolean
}) {
  return (
    <ol className="space-y-2 border-l border-border/70 pl-3">
      {preconditions.map((stated) => (
        <li
          key={`${stated.file}:${stated.line}|${stated.kind}|${stated.terms.map((term) => term.text).join('|')}`}
          data-precondition={stated.kind}
          title={`${stated.file}:${stated.line}`}
          className="space-y-0.5"
        >
          <p className="flex items-baseline gap-1.5 text-[13px] leading-relaxed">
            <PreconditionMark kind={stated.kind} className="translate-y-[2px]" />
            <span>
              <Requires stated={stated} domainId={domainId} />
            </span>
          </p>
          {stated.under !== undefined && <Under stated={stated} />}
          {stated.terms.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 pl-[calc(1em+0.375rem)] text-[12px] leading-relaxed">
              {stated.terms.map((term, index) => (
                <div key={index} data-precondition-term={term.term} className="contents">
                  <dt className="font-mono text-muted-foreground">{term.term}</dt>
                  <dd className="font-mono [overflow-wrap:anywhere]">{term.text}</dd>
                </div>
              ))}
            </dl>
          )}
          {stated.name !== undefined && (
            <p
              data-precondition-name=""
              className="pl-[calc(1em+0.375rem)] text-[12px] text-muted-foreground"
            >
              Fails as <span className="font-mono text-foreground/90">{stated.name}</span>
            </p>
          )}
          {stated.gap !== undefined && (
            <Meta className="pl-[calc(1em+0.375rem)]">Can’t tell: {stated.gap}</Meta>
          )}
          {mutations && (
            <Meta className="pl-[calc(1em+0.375rem)]">
              In{' '}
              <Joined
                items={stated.mutations.map((each) => (
                  <CallableName
                    key={each.id}
                    target={each.target}
                    name={each.id}
                    glyph="mutation"
                    domainId={domainId}
                  />
                ))}
              />
            </Meta>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * The conditions and loops a precondition is stated under, outermost first: a line each, quieter
 * than what it requires, each source as written.
 */
function Under({ stated }: { stated: PreconditionLine }) {
  return (
    <ul
      data-precondition-under=""
      className="pb-0.5 pl-[calc(1em+0.375rem)] text-[12px] leading-relaxed text-muted-foreground"
    >
      {stated.under?.map((condition, index) => {
        const said = conditionWords(condition)
        return (
          <li
            key={index}
            data-precondition-condition={condition.kind}
            title={`${stated.file}:${condition.line}`}
          >
            <span className="italic">{said.lead}</span>{' '}
            <span className="font-mono text-foreground/70 [overflow-wrap:anywhere]">
              {said.source}
            </span>
            {said.trail !== undefined && <span className="italic"> {said.trail}</span>}
          </li>
        )
      })}
    </ul>
  )
}
