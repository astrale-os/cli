/**
 * A rule on the stage: its walk as numbered steps, each a short phrase, beside its Figure. The
 * numbers are the walk's (`walkStepsOf`): the map numbers the same steps beside what each
 * follows, and the Figure carries them on the part each reads. Pointing at a step — the pointer
 * on it or on its number in the Figure, or the arrow keys through the list — lights that part in
 * the Figure and in the Inspector's words, and stands its number out on the map. Alternatives are
 * walked one after the other, indented under `either` and `or`.
 *
 * The steps sit beside the Figure while the stage is wide enough for both at the Figure's own
 * width, else above it, in as many columns as fit: the Figure keeps its whole width (its wires
 * are measured on the page, so it is never scaled), and one wider than the stage still scrolls
 * sideways as its frame lets it (`FigureFrame`). The band opens at the height they take whole;
 * held lower, they scroll, and the band's foot fades while more is below (`.stage-scroll`).
 */

import type { Highlight } from '@astrale-os/visual'

import { useRule } from '@astrale-os/visual/react'
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

import type { SceneTone } from '../scene/types'

import { useCanvas } from '../canvas/store'
import { TONE_COLOR } from '../canvas/tones'
import { type WalkStep, walkStepsOf, type WalkWord, walkWords } from '../lenses/rule-walk'
import { FigureFrame } from '../rules/figure-frame'
import { useStage } from './store'
import './stage.css'

/** The walk's header (`h-10`) and the band's top border above it, in px. */
const STAGE_HEAD = 41

/** The steps' column beside the Figure (`w-[19rem]`) and the gap after it (`gap-x-8`), in px. */
const STEPS_WIDTH = 304
const BESIDE_GAP = 32

/** The width the Figure in `host` takes unscaled, whatever room it is given. */
function naturalWidth(host: HTMLElement): number {
  const drawn = host.querySelector<HTMLElement>('.vr-figure')
  if (!drawn) return 0
  // `max-content` wide, floored at its host's width: read without the floor
  const floor = drawn.style.minWidth
  drawn.style.minWidth = '0px'
  const width = drawn.getBoundingClientRect().width
  drawn.style.minWidth = floor
  return Math.ceil(width)
}

/** What pointing at a step lights in the rule's words and Figure. */
function highlightOf(step: WalkStep): Highlight {
  if (step.kind === 'start' && step.entity) return { entity: step.entity }
  return {
    nodes: step.arrives ? [step.node, step.arrives] : [step.node],
    ...(step.to.you ? { role: 'subject' as const } : {}),
  }
}

/**
 * A line of the list: a step, or the word that opens an alternative at a depth. `group` is the
 * outermost alternative it stands in, or the step's own when it stands in none.
 */
type Line = { group: string } & (
  | { kind: 'step'; step: WalkStep }
  | { kind: 'either' | 'or'; depth: number; key: string }
)

/** The steps with `either` before a first alternative and `or` before each next one. */
function linesOf(steps: readonly WalkStep[]): Line[] {
  const lines: Line[] = []
  let before: WalkStep['within'] = []
  for (const step of steps) {
    const { within } = step
    let depth = 0
    while (
      depth < within.length &&
      depth < before.length &&
      within[depth]!.or === before[depth]!.or &&
      within[depth]!.operand === before[depth]!.operand
    )
      depth += 1
    const outer = within[0]
    const group =
      outer === undefined ? `step ${step.number}` : `or ${String(outer.or)}:${outer.operand}`
    for (let at = depth; at < within.length; at += 1) {
      const next = before[at]?.or === within[at]!.or && at === depth
      lines.push({ group, kind: next ? 'or' : 'either', depth: at, key: `${step.number}:${at}` })
    }
    lines.push({ group, kind: 'step', step })
    before = within
  }
  return lines
}

/**
 * The lines in runs a column never splits: an outermost alternative whole, under its `either` or
 * `or`, and a step outside one alone. A column breaks between alternatives, never inside one, so
 * a first step is never left alone above a whole either/or.
 */
function blocksOf(lines: readonly Line[]): Line[][] {
  const blocks: Line[][] = []
  for (const line of lines) {
    const last = blocks.at(-1)
    if (last?.[0]?.group === line.group) last.push(line)
    else blocks.push([line])
  }
  return blocks
}

/**
 * `title` names the rule; `tone` is the hue its numbers wear, as the map's; `marked` draws the
 * proof of the verdict in scope over the Figure, as a dataset reads one.
 */
export function RuleStage({
  title,
  tone,
  marked = false,
}: {
  title: string
  tone: SceneTone
  marked?: boolean
}) {
  const { rule, point } = useRule()
  const steps = walkStepsOf(rule)
  const [hover, setHover] = useState<number | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const [held, setHeld] = useState(rule)
  if (held !== rule) {
    setHeld(rule)
    setHover(null)
    setActive(null)
  }
  const pointed = hover ?? active
  const list = useRef<HTMLOListElement>(null)
  const id = useId()

  // The pointed step lights its part of the rule, and its number on the map.
  const setStep = useCanvas((state) => state.setStep)
  const setHovered = useCanvas((state) => state.setHovered)
  const lit = useRef(false)
  useEffect(() => {
    const step = pointed === null ? undefined : steps[pointed - 1]
    if (!step && !lit.current) return
    lit.current = step !== undefined
    point(step ? highlightOf(step) : undefined)
    setStep(step?.number ?? null)
    setHovered(step?.marks[0] ?? null)
  }, [point, pointed, setHovered, setStep, steps])
  useEffect(
    () => () => {
      if (!lit.current) return
      useCanvas.getState().setStep(null)
      useCanvas.getState().setHovered(null)
    },
    [],
  )
  useEffect(() => {
    if (active === null) return
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, id])

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const last = steps.length
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? active === null
          ? 1
          : Math.min(last, active + 1)
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? active === null
            ? last
            : Math.max(1, active - 1)
          : event.key === 'Home'
            ? 1
            : event.key === 'End'
              ? last
              : undefined
    if (next !== undefined && last > 0) {
      event.preventDefault()
      event.stopPropagation()
      // the keys lead until the pointer moves onto another step
      setHover(null)
      setActive(next)
    } else if (event.key === 'Escape' && active !== null) {
      // the step lets go before the rule's pin or the selection does
      event.preventDefault()
      event.stopPropagation()
      setActive(null)
    }
  }

  // Beside the Figure while both fit at its own width, else above it.
  const body = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLDivElement>(null)
  const [beside, setBeside] = useState(true)
  useLayoutEffect(() => {
    const room = body.current
    const host = figure.current?.querySelector<HTMLElement>('.vr-figure-host')
    if (!room || !host) return
    const fit = () => {
      const style = getComputedStyle(room)
      const inner =
        room.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setBeside(STEPS_WIDTH + BESIDE_GAP + naturalWidth(host) <= inner)
    }
    const sized = new ResizeObserver(fit)
    sized.observe(room)
    const redrawn = new MutationObserver(fit)
    redrawn.observe(host, { childList: true })
    fit()
    return () => {
      redrawn.disconnect()
      sized.disconnect()
    }
  }, [])
  // What it takes whole: the band opens at that height while the reader has set none.
  const setWants = useStage((state) => state.setWants)
  useLayoutEffect(() => {
    const room = body.current
    if (!room) return
    const measure = () => setWants(STAGE_HEAD + room.offsetHeight)
    const sized = new ResizeObserver(measure)
    sized.observe(room)
    measure()
    return () => {
      sized.disconnect()
      setWants(null)
    }
  }, [setWants])
  const toned = { '--step-tone': TONE_COLOR[tone] } as CSSProperties

  return (
    <div
      data-rule-stage=""
      data-stage-pointing={pointed ?? undefined}
      style={toned}
      className="flex h-full flex-col"
    >
      {/* clear of the band's controls, absolute at its top right */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b pl-4 pr-60">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Walk
        </span>
        <span className="min-w-0 truncate text-[13px] font-medium">{title}</span>
        {steps.length > 0 && (
          <span className="shrink-0 text-[12px] text-muted-foreground">
            · {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
        )}
        {steps.length > 1 && (
          <span className="ml-auto hidden shrink-0 text-[11px] text-muted-foreground md:inline">
            ↑ ↓ step through · Esc lets go
          </span>
        )}
      </div>
      <div className="stage-scroll min-h-0 flex-1 overflow-auto">
        <div
          ref={body}
          data-stage-layout={beside ? 'beside' : 'stacked'}
          className={cn('flex gap-x-8 gap-y-3 px-4 pb-4 pt-3', beside ? 'items-start' : 'flex-col')}
        >
          {steps.length > 0 && (
            <ol
              ref={list}
              role="listbox"
              tabIndex={0}
              aria-label="The walk, step by step"
              aria-activedescendant={active === null ? undefined : `${id}-${active}`}
              data-walk-steps=""
              onKeyDown={onKeyDown}
              onPointerLeave={() => setHover(null)}
              className={cn(
                'rounded-md text-[13px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                beside ? 'w-[19rem] flex-none' : 'columns-[20rem] gap-x-8',
              )}
            >
              {blocksOf(linesOf(steps)).map((block) => {
                const lines = block.map((line) =>
                  line.kind === 'step' ? (
                    <li
                      key={line.step.number}
                      id={`${id}-${line.step.number}`}
                      role="option"
                      aria-selected={active === line.step.number}
                      data-walk-step={line.step.number}
                      data-walk-kind={line.step.kind}
                      data-pointed={pointed === line.step.number ? '' : undefined}
                      onPointerEnter={() => setHover(line.step.number)}
                      onClick={() => {
                        setActive(active === line.step.number ? null : line.step.number)
                        list.current?.focus({ preventScroll: true })
                      }}
                      style={{ paddingLeft: 6 + line.step.within.length * 16 }}
                      className={cn(
                        'stage-line flex cursor-default break-inside-avoid items-start gap-2 rounded-md py-1 pr-2',
                        pointed === line.step.number && 'bg-accent',
                      )}
                    >
                      <span className="stage-step mt-px">{line.step.number}</span>
                      <span className="min-w-0">
                        <Phrase words={walkWords(line.step)} />
                      </span>
                    </li>
                  ) : (
                    <li
                      key={line.key}
                      role="presentation"
                      data-walk-alternative={line.kind}
                      onPointerEnter={() => setHover(null)}
                      style={{ paddingLeft: 6 + line.depth * 16 }}
                      className="break-after-avoid break-inside-avoid py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {line.kind}
                    </li>
                  ),
                )
                // an alternative stays whole in one column when the steps run in columns
                return block.length === 1 ? (
                  lines[0]
                ) : (
                  <div
                    key={block[0]!.group}
                    role="group"
                    data-walk-block=""
                    className="break-inside-avoid"
                  >
                    {lines}
                  </div>
                )
              })}
            </ol>
          )}
          <div
            ref={figure}
            data-stage-figure=""
            className={cn('relative min-w-0', beside ? 'flex-1' : 'w-full')}
          >
            <FigureFrame marked={marked} />
            <StepBadges steps={steps} pointed={pointed} onPoint={setHover} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** A step's phrase: names drawn as the map draws them. */
function Phrase({ words }: { words: readonly WalkWord[] }) {
  return (
    <>
      {words.map((word, index) =>
        word.kind === 'relationship' ? (
          <span key={index} className="font-mono text-[12px] text-schema-edge">
            {word.text}
          </span>
        ) : word.kind === 'class' ? (
          <span key={index} className="font-medium text-foreground">
            {word.text}
          </span>
        ) : word.kind === 'you' ? (
          <span key={index} className="font-medium text-foreground">
            {word.text}
          </span>
        ) : (
          <span key={index} className="text-foreground/80">
            {word.text}
          </span>
        ),
      )}
    </>
  )
}

interface Badge {
  number: number
  x: number
  y: number
}

/** The side of a step's number, as `.stage-step` draws it. */
const BADGE = 18

/** The element of the Figure a step's number stands on: the part that says the step, or its nearest. */
function anchorOf(host: HTMLElement, step: WalkStep): Element | undefined {
  if (step.kind === 'start' && step.entity) {
    const card = host.querySelector(`.vr-card[data-entity="${CSS.escape(step.entity)}"]`)
    if (card) return card
  }
  for (let node: string | undefined = step.node; node;) {
    const said = [...host.querySelectorAll(`[data-node="${CSS.escape(node)}"]`)]
    const found =
      said.find((element) => element.matches('.vr-label, .vr-card, .vr-test')) ??
      said.find((element) => !element.matches('.vr-region, .vr-lane'))
    if (found) return found
    const cut = node.lastIndexOf('/')
    node = cut > 0 ? node.slice(0, cut) : undefined
  }
  return undefined
}

/**
 * Each step's number on the Figure: before a link's name (where a choice of links stacks
 * several, level with its own), at a card's or a test's corner, on a
 * layer over the Figure beside it. Laid again whenever the Figure is drawn anew, changes size or
 * scrolls; a part scrolled out of sight shows no number.
 */
function StepBadges({
  steps,
  pointed,
  onPoint,
}: {
  steps: readonly WalkStep[]
  pointed: number | null
  onPoint: (step: number | null) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  useLayoutEffect(() => {
    const over = layer.current
    const host = over?.parentElement?.querySelector<HTMLElement>('.vr-figure-host')
    if (!over || !host) return
    const lay = () => {
      const origin = over.getBoundingClientRect()
      const seen = host.getBoundingClientRect()
      const taken = new Map<Element, number>()
      const next = steps.flatMap((step): Badge[] => {
        const anchor = anchorOf(host, step)
        if (!anchor) return []
        const rect = anchor.getBoundingClientRect()
        if (rect.right < seen.left || rect.left > seen.right) return []
        const count = taken.get(anchor) ?? 0
        taken.set(anchor, count + 1)
        // a link's name, or one of a choice's names: before the label, level with the name
        const label = anchor.closest('.vr-label')?.getBoundingClientRect()
        return [
          {
            number: step.number,
            x: (label ? label.left - BADGE - 4 : rect.left - BADGE / 2) - origin.left + count * 20,
            y: (label ? rect.top + rect.height / 2 - BADGE / 2 : rect.top - BADGE / 2) - origin.top,
          },
        ]
      })
      setBadges((was) =>
        was.length === next.length &&
        was.every(
          (badge, index) =>
            badge.number === next[index]!.number &&
            Math.abs(badge.x - next[index]!.x) < 0.5 &&
            Math.abs(badge.y - next[index]!.y) < 0.5,
        )
          ? was
          : next,
      )
    }
    const sized = new ResizeObserver(lay)
    const watch = () => {
      sized.disconnect()
      sized.observe(over)
      const drawn = host.querySelector('.vr-figure')
      if (drawn) sized.observe(drawn)
      lay()
    }
    const redrawn = new MutationObserver(watch)
    redrawn.observe(host, { childList: true })
    host.addEventListener('scroll', lay, { passive: true })
    watch()
    return () => {
      host.removeEventListener('scroll', lay)
      redrawn.disconnect()
      sized.disconnect()
    }
  }, [steps])
  return (
    <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0">
      {badges.map((badge) => (
        <span
          key={badge.number}
          data-figure-step={badge.number}
          data-pointed={pointed === badge.number ? '' : undefined}
          onPointerEnter={() => onPoint(badge.number)}
          onPointerLeave={() => onPoint(null)}
          style={{ transform: `translate(${badge.x}px, ${badge.y}px)` }}
          className="stage-step stage-badge pointer-events-auto"
        >
          {badge.number}
        </span>
      ))}
    </div>
  )
}
