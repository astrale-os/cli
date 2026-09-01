import { PanelLeftOpen } from 'lucide-react'
import { type ReactNode, createContext, useContext, useState } from 'react'

/**
 * The modules rail down the left of every schema canvas, with the drag handle that
 * resizes it. One component and ONE stored width: the rail is the same furniture
 * whether the canvas holds one domain, several, or a domain's core data.
 */
const MIN = 180
const MAX = 560
const DEFAULT = 240
const STORAGE_KEY = 'studio.modulesWidth'
const COLLAPSED_KEY = 'studio.modulesCollapsed'

function storedWidth(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(value) && value >= MIN && value <= MAX) return value
  } catch {}
  return DEFAULT
}

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {}
  return false
}

/**
 * The rail's own close button, offered to whatever header it was given: the header owns
 * its title bar's layout, so the control belongs beside its other controls rather than
 * floating over them. Absent (null) outside a rail — the header renders no button then.
 */
const CollapseContext = createContext<{ collapse: () => void } | null>(null)
export const useRailCollapse = () => useContext(CollapseContext)

export function ModulesSidebar({
  children,
  header,
  onClearSelection,
}: {
  children: ReactNode
  /** Pinned above the scroller — the rail's own title bar. */
  header?: ReactNode
  /** Called when the rail's empty space is clicked — see `clearOnBackgroundClick`. */
  onClearSelection?: () => void
}) {
  const [width, setWidth] = useState(storedWidth)
  const [collapsed, setCollapsed] = useState(storedCollapsed)

  const setCollapsedPersisted = (value: boolean) => {
    setCollapsed(value)
    try {
      localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
    } catch {}
  }

  // Clicking the rail beside the tree means the same thing as clicking the canvas pane:
  // nothing is selected. A press on a control — or anywhere on a tree row, whose padding
  // reads as part of the row it highlights — is that control's business and passes through.
  const clearOnBackgroundClick = (event: React.MouseEvent) => {
    if (!onClearSelection) return
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-tree-row], button, a, input, textarea, [role="separator"]')) return
    onClearSelection()
  }

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    let latest = startWidth
    const onMove = (move: PointerEvent) => {
      latest = Math.min(MAX, Math.max(MIN, startWidth + (move.clientX - startX)))
      setWidth(latest)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(STORAGE_KEY, String(latest))
      } catch {}
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Closed, the rail keeps a strip of itself rather than disappearing: the same button
  // that shut it is where you left it, so reopening never becomes a hunt.
  if (collapsed) {
    return (
      <div
        data-testid="modules-sidebar"
        data-collapsed="true"
        className="relative flex min-h-0 w-10 shrink-0 flex-col items-center border-r"
      >
        <button
          type="button"
          onClick={() => setCollapsedPersisted(false)}
          title="Show domains"
          aria-label="Show domains"
          aria-expanded={false}
          className="grid h-10 w-10 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <span className="mt-1 select-none text-[11px] font-semibold uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
          Domains
        </span>
      </div>
    )
  }

  return (
    <div
      data-testid="modules-sidebar"
      className="relative flex min-h-0 shrink-0 flex-col border-r"
      style={{ width }}
      onClick={clearOnBackgroundClick}
    >
      <CollapseContext.Provider value={{ collapse: () => setCollapsedPersisted(true) }}>
        {header}
      </CollapseContext.Provider>
      <div className="min-h-0 flex-1">{children}</div>
      {/* drag handle straddling the right border */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        title="Drag to resize"
        className="group absolute right-0 top-0 z-20 h-full w-1.5 translate-x-1/2 cursor-col-resize"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/50" />
      </div>
    </div>
  )
}
