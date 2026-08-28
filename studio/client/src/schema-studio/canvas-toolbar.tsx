import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc'
import { cn } from '@/lib/utils'

/** The canvas's single toolbar: one bar, one idiom for every canvas toggle. */
export function CanvasToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      {children}
    </div>
  )
}

export function CanvasToggle({
  icon,
  label,
  count,
  pressed,
  title,
  onClick,
}: {
  icon: ReactNode
  label: string
  count?: number
  pressed: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
        pressed
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={cn('tabular-nums', pressed ? 'text-primary/70' : 'text-muted-foreground')}>
          {count}
        </span>
      )}
    </button>
  )
}

/**
 * A reading-mode switch: the glyph IS the control, and a tooltip spells out what
 * turning it on changes. These toggles never leave the bar, so their meaning is
 * learned once — a permanent word next to each one only crowds the canvas.
 * `hint` must say what you get, not repeat the name.
 */
export function CanvasIconToggle({
  icon,
  label,
  hint,
  pressed,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
            pressed
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <span className="ml-1.5 text-muted-foreground">{hint}</span>
      </TooltipContent>
    </Tooltip>
  )
}
