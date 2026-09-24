import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type SectionKey, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

interface TourStep {
  title: string
  body: string
  /** Where the spotlight lands: the first selector that is on screen wins. None on
   *  screen — a collapsed rail, a docked panel — and the card simply sits centred. */
  targets?: string[]
  /** The section the step is about, opened before it is shown. */
  section?: SectionKey
}

/** Seven steps at most: the tour names the building blocks and gets out of the way. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: 'Welcome to Astrale Studio',
    body: 'Astrale is an operating system built on a graph: data, people and code are nodes linked by edges. Access lives in the graph too. Applications install on top of it — and this studio is where you build them.',
  },
  {
    title: 'Domains',
    body: 'A domain is one area of a business — issue tracking, billing, a CRM — with everything it needs, and it exposes an application. Creating or updating one takes three moves: build it (TypeScript code, shaped here), deploy it (its code goes live at a URL), then install it on an instance (its schema joins that graph). This rail lists the domains in your workspace.',
    targets: ['[data-testid="modules-sidebar"]'],
    section: 'schema',
  },
  {
    title: 'The schema',
    body: 'What a domain adds to the graph. Node classes are the things that exist; edge classes are the relationships between them; abstract classes are traits several classes share, like Named. A function is an operation you can call — open an issue, invite a member — guarded by its policies. A function attached to a class is called a method. Click a card to see all of it.',
    targets: [
      '[data-testid="workspace-schema-canvas"]',
      '[data-testid="workspace-schema-section"]',
    ],
    section: 'schema',
  },
  {
    title: 'Four readings of one domain',
    body: 'Schema is the model. Core is the reference data installed with the domain, there from day one — a built-in group, for instance. Tests holds demo datasets: small example graphs that tell the domain’s story, on which you also check who may do what. Process lists its functions — actions and workflows — and its views.',
    targets: ['[data-tour="sections"]'],
  },
  {
    title: 'Comment on anything',
    body: 'Press C, click any element, and leave a note or a question. Comments stay attached to what they point at, so they read as a to-do list on the domain itself.',
    targets: ['[data-tour="comment"]'],
  },
  {
    title: 'Hand it to the agent',
    body: 'Ask here in plain words, or send your comments along. A local Claude Code or Codex agent edits the domain code on disk and replies — the studio redraws as the code changes.',
    targets: ['[data-testid="agent-dock"]', '[data-tour="agent"] button'],
  },
]

/** The gap between the spotlight and what it frames, and between the frame and the card. */
const PAD = 6
const GAP = 12
const CARD_WIDTH = 340

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function findTarget(selectors: readonly string[] | undefined): Rect | null {
  for (const selector of selectors ?? []) {
    const box = document.querySelector(selector)?.getBoundingClientRect()
    if (box && box.width > 0 && box.height > 0) {
      return {
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
      }
    }
  }
  return null
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/**
 * Where the card sits: beside a tall target, under or over a wide one, and inside the
 * window whatever happens. A target that fills most of the screen gets the card over it.
 */
function placeCard(target: Rect | null, cardHeight: number): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(CARD_WIDTH, vw - 32)
  const clampLeft = (left: number) => Math.min(Math.max(16, left), vw - width - 16)
  const clampTop = (top: number) => Math.min(Math.max(16, top), vh - cardHeight - 16)
  if (!target) return { top: clampTop((vh - cardHeight) / 2), left: clampLeft((vw - width) / 2) }

  const right = target.left + target.width + GAP
  const below = target.top + target.height + GAP
  const tall = target.height > vh * 0.5
  // Nothing beside it has room: sit in its top-left corner, where a canvas is emptiest.
  if (tall && target.width > vw * 0.6)
    return { top: clampTop(target.top + 24), left: clampLeft(target.left + 24) }
  if (tall && right + width <= vw - 16) return { top: clampTop(target.top + 24), left: right }
  if (tall && target.left - GAP - width >= 16)
    return { top: clampTop(target.top + 24), left: target.left - GAP - width }
  const centred = clampLeft(target.left + target.width / 2 - width / 2)
  if (below + cardHeight <= vh - 16) return { top: below, left: centred }
  if (target.top - GAP - cardHeight >= 16)
    return { top: target.top - GAP - cardHeight, left: centred }
  return { top: clampTop((vh - cardHeight) / 2), left: clampLeft((vw - width) / 2) }
}

/**
 * The onboarding tour: a spotlight over one part of the studio at a time, and a card that
 * says what it is. It is opt-in — nothing opens it on first launch.
 */
export function Tour() {
  const open = useUI((s) => s.tourOpen)
  const setOpen = useUI((s) => s.setTourOpen)
  const setSection = useUI((s) => s.setSection)
  const [index, setIndex] = useState(0)
  const [target, setTarget] = useState<Rect | null>(null)
  const [card, setCard] = useState<HTMLDivElement | null>(null)
  const [cardHeight, setCardHeight] = useState(180)
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1

  // Every run starts at the beginning, and on a quiet screen: the tour points at things,
  // so nothing may float over what it points at.
  useEffect(() => {
    if (!open) return
    setIndex(0)
    useUI.setState({ paletteOpen: false, settingsOpen: false, commentMode: false, askMode: false })
  }, [open])

  useEffect(() => {
    if (open && step?.section) setSection(step.section)
  }, [open, step, setSection])

  // Targets move — a lazy section landing, a canvas fitting its view, a window resized —
  // so the spotlight follows the element each frame rather than trusting one measure.
  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    const follow = () => {
      const next = findTarget(step?.targets)
      setTarget((current) => (sameRect(current, next) ? current : next))
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(frame)
  }, [open, step])

  useLayoutEffect(() => {
    if (!card) return
    const observer = new ResizeObserver(() => setCardHeight(card.offsetHeight))
    observer.observe(card)
    return () => observer.disconnect()
  }, [card])

  const close = useCallback(() => setOpen(false), [setOpen])
  const next = useCallback(() => {
    if (last) close()
    else setIndex((i) => i + 1)
  }, [last, close])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Captured before the studio's own hotkeys (C, A, Esc) so a keystroke meant for the
  // tour never also toggles a mode behind it.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      else if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') back()
      else if (event.key === 'Enter' || event.key === 'Tab' || event.metaKey || event.ctrlKey)
        return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, close, next, back])

  if (!open || !step) return null
  const position = placeCard(target, cardHeight)

  return (
    <div className="fixed inset-0 z-[60]" data-testid="studio-tour">
      {/* The dimmed screen is the spotlight's shadow; with no target it dims everything. */}
      {target ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary/70 transition-all duration-300 ease-out"
          style={{ ...target, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.5)' }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/50" />
      )}

      <div
        ref={setCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-tour-title"
        className="absolute rounded-xl border bg-card p-4 text-card-foreground shadow-[0_24px_60px_-24px_rgb(0_0_0/0.35)] transition-[top,left] duration-300 ease-out"
        style={{ ...position, width: Math.min(CARD_WIDTH, window.innerWidth - 32) }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {index + 1} / {TOUR_STEPS.length}
            </div>
            <h2 id="studio-tour-title" className="mt-0.5 text-[15px] font-semibold">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close tour"
            onClick={close}
            className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex items-center gap-1" aria-hidden>
            {TOUR_STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-4 bg-primary' : 'w-1.5 bg-border',
                )}
              />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={back}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={next} autoFocus>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
