import { cn } from '@/lib/utils'

/**
 * A tiny pin/badge that marks an element as having comment threads.
 * Sits at an element corner. Clicking opens the thread popover.
 *
 *  - open      → primary filled (there are unresolved threads)
 *  - resolved  → muted (every thread is closed)
 *  - orphaned  → destructive ring (the anchor ref no longer resolves)
 */
export function CommentPin({
  count,
  status,
  orphaned,
  onClick,
  className,
}: {
  count: number
  status: 'open' | 'resolved'
  orphaned?: boolean
  onClick?: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      title={`${count} ${count === 1 ? 'thread' : 'threads'}${orphaned ? ' · orphaned' : status === 'resolved' ? ' · resolved' : ''}`}
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums shadow-sm transition-colors',
        'ring-1 ring-inset cursor-pointer select-none',
        status === 'open'
          ? 'bg-primary text-primary-foreground ring-primary/40 hover:bg-primary/90'
          : 'bg-muted text-muted-foreground ring-border hover:bg-muted/80',
        orphaned && 'ring-2 ring-destructive text-destructive bg-destructive/15',
        className,
      )}
    >
      {count}
    </button>
  )
}
