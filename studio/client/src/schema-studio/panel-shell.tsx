import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useUI } from '@/lib/store'

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
  const drag = useRef<{ x: number; width: number } | null>(null)
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
      <div
        role="separator"
        aria-label="Resize detail panel"
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title="Drag to resize"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          drag.current = { x: event.clientX, width }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width + drag.current.x - event.clientX)
        }}
        onPointerUp={(event) => {
          drag.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowLeft'
              ? width + 20
              : event.key === 'ArrowRight'
                ? width - 20
                : event.key === 'Home'
                  ? min
                  : event.key === 'End'
                    ? max
                    : null
          if (next === null) return
          event.preventDefault()
          resize(next)
        }}
        className="group absolute left-0 top-0 z-30 h-full w-2 -translate-x-1/2 touch-none select-none cursor-col-resize focus-visible:outline-none"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary" />
      </div>
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
