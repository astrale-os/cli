import { MessageCircle, MessageSquare, PanelBottom, PanelLeft, PanelRight, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useComments } from '@/lib/hooks'
import { type PanelSide, useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { AgentTab } from './agent-tab'
import { CommentsTab } from './comments-tab'

const MIN_SIZE = 260
const MAX_SIZE = 900

const SIDES: { side: PanelSide; icon: typeof PanelLeft; label: string }[] = [
  { side: 'left', icon: PanelLeft, label: 'Left' },
  { side: 'right', icon: PanelRight, label: 'Right' },
  { side: 'bottom', icon: PanelBottom, label: 'Bottom' },
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
 * The work panel: the agent conversation and the comment threads, docked beside
 * whatever you are looking at. Collapsed, it leaves a rail of tab icons — the
 * way back in, without spending a slot in the app header.
 */
export function WorkPanel({ domainId }: { domainId: string }) {
  const open = useUI((s) => s.panelOpen)
  return open ? <ExpandedPanel domainId={domainId} /> : <CollapsedRail domainId={domainId} />
}

function CollapsedRail({ domainId }: { domainId: string }) {
  const side = useUI((s) => s.panelSide)
  const setPanelTab = useUI((s) => s.setPanelTab)
  const waiting = useWaitingCount(domainId)
  const horizontal = side !== 'bottom'
  return (
    <aside
      className={cn(
        'flex shrink-0 items-center gap-1 bg-card p-1.5',
        horizontal ? 'flex-col' : 'flex-row',
        side === 'left' && 'border-r',
        side === 'right' && 'border-l',
        side === 'bottom' && 'border-t',
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

function ExpandedPanel({ domainId }: { domainId: string }) {
  const side = useUI((s) => s.panelSide)
  const size = useUI((s) => s.panelSize)
  const tab = useUI((s) => s.panelTab)
  const setPanelTab = useUI((s) => s.setPanelTab)
  const setPanelSize = useUI((s) => s.setPanelSize)
  const setPanelOpen = useUI((s) => s.setPanelOpen)
  const waiting = useWaitingCount(domainId)
  const horizontal = side !== 'bottom'
  const startResize = useResize(side, size, setPanelSize)
  // a narrow panel can't hold two labelled tabs, a dock control and a close button
  const narrow = horizontal && size < 340

  return (
    <aside
      style={horizontal ? { width: size } : { height: size }}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col bg-card',
        side === 'left' && 'border-r',
        side === 'right' && 'border-l',
        side === 'bottom' && 'border-t',
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
          <TabButton
            active={tab === 'agent'}
            onClick={() => setPanelTab('agent')}
            icon={<MessageCircle />}
            label="Agent"
            compact={narrow}
          />
          <TabButton
            active={tab === 'comments'}
            onClick={() => setPanelTab('comments')}
            icon={<MessageSquare />}
            label="Comments"
            badge={waiting}
            compact={narrow}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <DockPicker />
          <button
            type="button"
            title="Collapse the panel"
            aria-label="Collapse the panel"
            onClick={() => setPanelOpen(false)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 border-t">
        {tab === 'agent' ? <AgentTab domainId={domainId} /> : <CommentsTab domainId={domainId} />}
      </div>

      {/* drag handle on the edge that faces the main view */}
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        onPointerDown={startResize}
        title="Drag to resize"
        className={cn(
          'group absolute z-20',
          side === 'left' && 'right-0 top-0 h-full w-1.5 translate-x-1/2 cursor-col-resize',
          side === 'right' && 'left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize',
          side === 'bottom' && 'left-0 top-0 h-1.5 w-full -translate-y-1/2 cursor-row-resize',
        )}
      >
        <div
          className={cn(
            'bg-transparent transition-colors group-hover:bg-primary/50',
            horizontal ? 'mx-auto h-full w-px' : 'my-auto h-px w-full',
          )}
        />
      </div>
    </aside>
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
          {SIDES.map(({ side: candidate, label }) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={side === candidate}
              title={label}
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

/** A miniature of the layout: the filled part is where the panel goes. */
function DockPreview({ side }: { side: PanelSide }) {
  return (
    <span
      className={cn(
        'flex h-8 w-11 overflow-hidden rounded border bg-muted',
        side === 'bottom' ? 'flex-col' : 'flex-row',
        side === 'right' && 'flex-row-reverse',
        side === 'bottom' && 'flex-col-reverse',
      )}
    >
      <span className={cn('bg-primary/60', side === 'bottom' ? 'h-2.5 w-full' : 'h-full w-3.5')} />
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
  side: PanelSide,
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
      const start = side === 'bottom' ? event.clientY : event.clientX
      const startSize = latest.current
      const onMove = (move: PointerEvent) => {
        const delta =
          side === 'left'
            ? move.clientX - start
            : side === 'right'
              ? start - move.clientX
              : start - move.clientY
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
      document.body.style.cursor = side === 'bottom' ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [side, setPanelSize],
  )
}
