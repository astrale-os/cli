/**
 * The Figure of the rule in scope, in the room it is given (the stage, `RuleStage`). The Figure
 * keeps its own width (its wires are measured on the page, so it is never scaled): it fits, or it
 * scrolls sideways inside that room. An edge with more of it beyond fades, and a button under that edge scrolls that way:
 * under the Figure, never over a part of it. The Figure's title line stays in view and never
 * fades. What scrolls never reads as cut, and nothing reaches past the room.
 */

import { RuleFigure } from '@astrale-os/visual/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

/** How much of the room one press scrolls. */
const STEP = 0.8

interface Beyond {
  left: boolean
  right: boolean
}

const FITS: Beyond = { left: false, right: false }
const same = (a: Beyond, b: Beyond) => a.left === b.left && a.right === b.right

/** `marked`: with the verdict in scope's proof drawn over it (`RuleFigure`). */
export function FigureFrame({ marked = false }: { marked?: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const [beyond, setBeyond] = useState<Beyond>(FITS)
  useLayoutEffect(() => {
    const host = frame.current?.querySelector<HTMLElement>('.vr-figure-host')
    if (!host) return
    const read = () => {
      const top = host.getBoundingClientRect().top
      const title = host.querySelector('.vr-figure > .vr-region > .vr-scope-head')
      const head = title ? Math.round(title.getBoundingClientRect().bottom - top) : 0
      const now: Beyond = {
        left: host.scrollLeft > 1,
        right: host.scrollLeft + host.clientWidth < host.scrollWidth - 1,
      }
      // the fade stops at the title line (`rules.css`)
      host.style.setProperty('--figure-head', `${head}px`)
      setBeyond((was) => (same(was, now) ? was : now))
    }
    // The host keeps its element; the Figure inside it is drawn anew whenever the rule changes.
    const sized = new ResizeObserver(read)
    const watch = () => {
      sized.disconnect()
      sized.observe(host)
      const figure = host.querySelector('.vr-figure')
      if (figure) sized.observe(figure)
      read()
    }
    const redrawn = new MutationObserver(watch)
    redrawn.observe(host, { childList: true })
    host.addEventListener('scroll', read, { passive: true })
    watch()
    return () => {
      host.removeEventListener('scroll', read)
      redrawn.disconnect()
      sized.disconnect()
    }
  }, [])
  const scroll = (direction: -1 | 1) => {
    const host = frame.current?.querySelector<HTMLElement>('.vr-figure-host')
    host?.scrollBy({ left: direction * host.clientWidth * STEP, behavior: 'smooth' })
  }
  const scrolls = beyond.left || beyond.right
  return (
    <div ref={frame} className="studio-figure pb-1" data-figure-fit={scrolls ? 'scrolls' : 'fits'}>
      <RuleFigure marked={marked} />
      {scrolls && (
        <div className="mt-1 flex h-7 items-center justify-between">
          {beyond.left ? <More side="left" onPress={() => scroll(-1)} /> : <span />}
          {beyond.right && <More side="right" onPress={() => scroll(1)} />}
        </div>
      )}
    </div>
  )
}

function More({ side, onPress }: { side: 'left' | 'right'; onPress: () => void }) {
  const Chevron = side === 'left' ? ChevronLeft : ChevronRight
  const said = `More of the Figure to the ${side}`
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-figure-more={side}
      aria-label={said}
      title={said}
      onClick={onPress}
      className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
    >
      <Chevron aria-hidden />
    </Button>
  )
}
