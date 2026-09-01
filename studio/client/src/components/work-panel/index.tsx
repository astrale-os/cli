import { MessageCircle, MessageSquare, PanelBottom, PanelLeft, PanelRight, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useComments } from '@/lib/hooks'
import { type PanelSide, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { AgentComposer, AgentDropZone, AgentTab, AgentTranscript } from './agent-tab'
import { CommentsTab } from './comments-tab'

const MIN_SIZE = 260
const MAX_SIZE = 900

/** The sides that dock a column. `bottom` is the floating dock and never does. */
type DockedSide = Exclude<PanelSide, 'bottom'>

/** In the order the previews stand on screen: the centred dock BETWEEN the two
 *  columns, so the row reads as the three places the panel can be rather than a
 *  list with the default at one end. */
const SIDES: { side: PanelSide; icon: typeof PanelLeft; label: string; hint: string }[] = [
  { side: 'left', icon: PanelLeft, label: 'Left', hint: 'A column left of the view' },
  {
    side: 'bottom',
    icon: PanelBottom,
    label: 'Bottom',
    hint: 'Just a composer under the view — the chat opens in the middle',
  },
  { side: 'right', icon: PanelRight, label: 'Right', hint: 'A column right of the view' },
]

/** Threads whose last word came from the agent — the ones waiting on you. */
function useWaitingCount(domainId: string): number {
  const { data } = useComments(domainId)
  return (
    data?.comments.filter((c) => c.status === 'open' && c.thread.at(-1)?.role === 'author')
      .length ?? 0
  )
}

/**
 * The work panel: the agent conversation and the comment threads, showing beside
 * whatever you are looking at.
 *
 * Docked left or right it is a column — collapsed, it leaves a rail of tab icons,
 * the way back in without spending a slot in the app header. Docked bottom it does
 * not take space at all: the composer floats over the view, and the conversation
 * grows out of it for as long as you are in it.
 */
export function WorkPanel({ domainId }: { domainId: string }) {
  const side = useUI((s) => s.panelSide)
  const open = useUI((s) => s.panelOpen)
  if (side === 'bottom') return <FloatingDock domainId={domainId} />
  return open ? (
    <ExpandedPanel domainId={domainId} side={side} />
  ) : (
    <CollapsedRail domainId={domainId} side={side} />
  )
}

function CollapsedRail({ domainId, side }: { domainId: string; side: DockedSide }) {
  const setPanelTab = useUI((s) => s.setPanelTab)
  const waiting = useWaitingCount(domainId)
  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col items-center gap-1 bg-card p-1.5',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <RailButton label="Agent" onClick={() => setPanelTab('agent')}>
        <MessageCircle className="h-4 w-4" />
      </RailButton>
      <RailButton label="Comments" badge={waiting} onClick={() => setPanelTab('comments')}>
        <MessageSquare className="h-4 w-4" />
      </RailButton>
    </aside>
  )
}

function RailButton({
  label,
  badge,
  onClick,
  children,
}: {
  label: string
  badge?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="relative grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
      )}
    </button>
  )
}

function ExpandedPanel({ domainId, side }: { domainId: string; side: DockedSide }) {
  const size = useUI((s) => s.panelSize)
  const setPanelSize = useUI((s) => s.setPanelSize)
  const setPanelOpen = useUI((s) => s.setPanelOpen)
  const startResize = useResize(side, size, setPanelSize)

  return (
    <aside
      style={{ width: size }}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col bg-card',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <PanelHeader
        domainId={domainId}
        // a narrow panel can't hold two labelled tabs, a dock control and a close button
        compact={size < 340}
        closeLabel="Collapse the panel"
        onClose={() => setPanelOpen(false)}
      />
      <PanelContent domainId={domainId} />

      {/* drag handle on the edge that faces the main view */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        title="Drag to resize"
        className={cn(
          'group absolute top-0 z-20 h-full w-1.5 cursor-col-resize',
          side === 'left' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2',
        )}
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/50" />
      </div>
    </aside>
  )
}

/**
 * The bottom dock: the composer itself, floating over the view, and the
 * conversation unfolding above it when you write in it.
 *
 * Nothing here is docked. The graph runs on behind the bar rather than being
 * pushed off the bottom of the window, and the bar keeps its exact place through
 * the whole opening — what grows is the space above it, so the field under the
 * caret never moves. Closing is just that space going back to nothing.
 */
function FloatingDock({ domainId }: { domainId: string }) {
  const open = useUI((s) => s.panelOpen)
  const tab = useUI((s) => s.panelTab)
  const setPanelOpen = useUI((s) => s.setPanelOpen)
  const setPanelTab = useUI((s) => s.setPanelTab)
  const waiting = useWaitingCount(domainId)
  const box = useRef<HTMLDivElement>(null)

  const field = useCallback(
    () => box.current?.querySelector<HTMLTextAreaElement>('[data-agent-composer]'),
    [],
  )
  const close = useCallback(() => {
    // the composer stays focused after a click that missed it, and a focused
    // composer is what "open" means here — hand the caret back to the view
    field()?.blur()
    setPanelOpen(false)
  }, [field, setPanelOpen])
  useDismiss(box, open, close)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-4">
      <AgentDropZone
        domainId={domainId}
        ref={box}
        data-testid="agent-dock"
        onPointerDown={(event) => {
          // Anywhere on the resting bar means "open it" — not just the field. An
          // unreachable agent leaves that field disabled, and the bar is the only way
          // to the tabs and to the dock control that moves the panel back off here.
          if (open || (event.target as Element).closest('button')) return
          setPanelTab('agent')
          field()?.focus()
        }}
        className={cn(
          'pointer-events-auto relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border',
          'shadow-[0_20px_60px_-28px_rgb(0_0_0/0.55)] backdrop-blur-xl transition-colors duration-300',
          // at rest it is a bar over a canvas, and seeing the canvas through it is the
          // point; opened it is something to read, and that wants a solid page
          open ? 'bg-card' : 'bg-card/80',
        )}
      >
        {/* The conversation. Its height IS the animation — the composer below is
            shrink-0, so growing this pushes the whole box up off the bar. */}
        <div
          inert={!open}
          className={cn(
            'flex min-h-0 flex-col overflow-hidden transition-[height] duration-300 ease-out',
            open ? 'h-[min(60vh,480px)]' : 'h-0',
          )}
        >
          <PanelHeader domainId={domainId} closeLabel="Close the chat" onClose={close} />
          <div className="min-h-0 flex-1 border-t">
            {tab === 'agent' ? (
              <AgentTranscript domainId={domainId} />
            ) : (
              <CommentsTab domainId={domainId} />
            )}
          </div>
        </div>

        <AgentComposer
          domainId={domainId}
          bar
          expanded={open}
          // opens on the agent, but never yanks you off the comments you opened it on
          onFocus={() => !open && setPanelTab('agent')}
          // the only way back to the threads while the dock rests: there is no tab
          // strip until it opens, and the badge is how a reply announces itself
          trailing={
            <RailButton
              label="Open comments"
              badge={waiting}
              onClick={() => setPanelTab('comments')}
            >
              <MessageSquare className="h-4 w-4" />
            </RailButton>
          }
        />
      </AgentDropZone>
    </div>
  )
}

/**
 * Close on Escape, or on a pointer landing anywhere but inside.
 *
 * Our own menus — the model picker, the dock picker, the documents list — portal
 * out to the body, so by the DOM they land *outside* the box. Reaching for one
 * must not be read as reaching past it.
 */
function useDismiss(
  box: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const inMenu = (node: Node | null) =>
      node instanceof Element && !!node.closest('[data-radix-popper-content-wrapper]')
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (box.current?.contains(target) || inMenu(target))) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // An open menu takes Escape first; it is the layer on top. Read that in the
      // CAPTURE phase — Radix listens on the bubble and closes its menu synchronously,
      // so by the time a bubble listener looks, the menu it should have deferred to
      // is already gone from the DOM.
      if (event.key !== 'Escape' || document.querySelector('[data-radix-popper-content-wrapper]'))
        return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [box, open, close])
}

/** The tab strip and the panel's own controls — the same row docked or floating. */
function PanelHeader({
  domainId,
  compact,
  closeLabel,
  onClose,
}: {
  domainId: string
  compact?: boolean
  closeLabel: string
  onClose: () => void
}) {
  const tab = useUI((s) => s.panelTab)
  const setPanelTab = useUI((s) => s.setPanelTab)
  const waiting = useWaitingCount(domainId)

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 px-2">
      <div className="flex min-w-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
        <TabButton
          active={tab === 'agent'}
          onClick={() => setPanelTab('agent')}
          icon={<MessageCircle />}
          label="Agent"
          compact={compact}
        />
        <TabButton
          active={tab === 'comments'}
          onClick={() => setPanelTab('comments')}
          icon={<MessageSquare />}
          label="Comments"
          badge={waiting}
          compact={compact}
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <DockPicker />
        <button
          type="button"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}

function PanelContent({ domainId }: { domainId: string }) {
  const tab = useUI((s) => s.panelTab)
  return (
    <div className="min-h-0 flex-1 border-t">
      {tab === 'agent' ? <AgentTab domainId={domainId} /> : <CommentsTab domainId={domainId} />}
    </div>
  )
}

/** One control for where the panel lives: the current side, three previews on click. */
function DockPicker() {
  const side = useUI((s) => s.panelSide)
  const setPanelSide = useUI((s) => s.setPanelSide)
  const [open, setOpen] = useState(false)
  const Current = SIDES.find((entry) => entry.side === side)?.icon ?? PanelLeft

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Where the panel sits"
          aria-label="Where the panel sits"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Current className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-auto p-1.5">
        <div className="flex gap-1.5">
          {SIDES.map(({ side: candidate, label, hint }) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={side === candidate}
              title={hint}
              onClick={() => {
                setPanelSide(candidate)
                setOpen(false)
              }}
              className={cn(
                'flex w-16 flex-col items-center gap-1 rounded-md p-1.5 transition-colors',
                side === candidate ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <DockPreview side={candidate} />
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** A miniature of the layout: the filled part is where the panel goes. Bottom shows
 *  what it really costs — a bar, with the chat floating clear of it. */
function DockPreview({ side }: { side: PanelSide }) {
  if (side === 'bottom') {
    return (
      <span className="relative block h-8 w-11 overflow-hidden rounded border bg-card">
        {/* the conversation, floating clear of the view */}
        <span className="absolute left-1/2 top-[7px] h-3 w-5 -translate-x-1/2 rounded-[3px] border border-primary/50 bg-primary/25" />
        {/* the bar, and all this layout costs */}
        <span className="absolute inset-x-1 bottom-1 h-1 rounded-full bg-primary/60" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        'flex h-8 w-11 flex-row overflow-hidden rounded border bg-muted',
        side === 'right' && 'flex-row-reverse',
      )}
    >
      <span className="h-full w-3.5 bg-primary/60" />
      <span className="flex-1 bg-card" />
    </span>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
  compact,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: number
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={compact ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded px-2 text-[13px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {!compact && label}
      {badge !== undefined && badge > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/** Drag the panel's inner edge; the size persists across sessions. */
function useResize(
  side: DockedSide,
  size: number,
  setPanelSize: (next: number) => void,
): (event: React.PointerEvent) => void {
  const latest = useRef(size)
  useEffect(() => {
    latest.current = size
  }, [size])

  return useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const start = event.clientX
      const startSize = latest.current
      const onMove = (move: PointerEvent) => {
        const delta = side === 'left' ? move.clientX - start : start - move.clientX
        latest.current = Math.min(MAX_SIZE, Math.max(MIN_SIZE, startSize + delta))
        setPanelSize(latest.current)
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [side, setPanelSize],
  )
}
