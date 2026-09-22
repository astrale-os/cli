import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ResizeHandle } from '@/components/ui/resize-handle'
import { useUI } from '@/lib/store'

/** The panel's default width, restored by a double click on its edge. */
const DEFAULT_WIDTH = 420

export function PanelShell({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  const preferredWidth = useUI((state) => state.detailWidth)
  const setWidth = useUI((state) => state.setDetailWidth)
  const panel = useRef<HTMLDivElement>(null)
  const dragFrom = useRef(preferredWidth)
  const [availableWidth, setAvailableWidth] = useState(900)
  const max = Math.min(900, availableWidth)
  const min = Math.min(320, max)
  const width = Math.min(preferredWidth, max)
  const resize = (next: number) => setWidth(Math.min(max, Math.max(min, next)))

  useEffect(() => {
    const container = panel.current?.parentElement
    if (!container) return
    const measure = () => {
      const rail = container.querySelector<HTMLElement>(':scope > [data-testid="modules-sidebar"]')
      // Leave the rail and a usable strip of canvas visible on narrower windows.
      setAvailableWidth(Math.max(160, container.clientWidth - (rail?.offsetWidth ?? 0) - 160))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const rail of container.querySelectorAll(':scope > [data-testid="modules-sidebar"]'))
      observer.observe(rail)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={panel} style={{ width }} className="relative min-h-0 shrink-0 border-l bg-card">
      <ResizeHandle
        orientation="vertical"
        label="Resize detail panel"
        className="left-0 top-0 h-full w-2 -translate-x-1/2"
        value={width}
        min={min}
        max={max}
        // the grip is on the panel's left edge: dragging left widens it
        onDragStart={() => (dragFrom.current = width)}
        onDrag={(dx) => resize(dragFrom.current - dx)}
        onStep={(dx) => resize(width - dx)}
        onLimit={(to) => resize(to === 'min' ? min : max)}
        onReset={() => resize(DEFAULT_WIDTH)}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        title="Close (Esc)"
        className="absolute right-3.5 top-3.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  )
}
