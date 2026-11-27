/** The Workspace pages' title block: what the page is about, its name, and what it offers. */

import type { ReactNode } from 'react'

export function PageHeader({
  kicker,
  icon,
  name,
  sublabel,
  children,
}: {
  kicker: string
  icon?: ReactNode
  name: string
  sublabel?: ReactNode
  /** the page's actions */
  children?: ReactNode
}) {
  return (
    <header className="space-y-2.5 pr-8">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon !== undefined && (
          <span className="flex shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        )}
        <span className="min-w-0 truncate">{kicker}</span>
      </div>
      <h2 className="break-words text-[18px] font-semibold leading-tight tracking-tight">{name}</h2>
      {sublabel !== undefined && (
        <p className="break-all font-mono text-[12px] text-muted-foreground">{sublabel}</p>
      )}
      {children !== undefined && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
    </header>
  )
}

/** A sentence that asks the reader to act. */
export function Callout({
  children,
  tone = 'warning',
}: {
  children: ReactNode
  tone?: 'warning' | 'quiet'
}) {
  return (
    <p
      className={
        tone === 'warning'
          ? 'rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-[13px] leading-relaxed'
          : 'rounded-md border bg-muted/40 px-3 py-2 text-[13px] leading-relaxed'
      }
    >
      {children}
    </p>
  )
}

/** A line of the page that selects something on the map. */
export function SelectLine({
  onSelect,
  children,
  trailing,
  ...rest
}: {
  onSelect: () => void
  children: ReactNode
  trailing?: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-baseline gap-2 rounded-sm py-1 text-left text-[13px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      {...rest}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {trailing !== undefined && (
        <span className="shrink-0 text-[12px] text-muted-foreground group-hover:text-foreground">
          {trailing}
        </span>
      )}
    </button>
  )
}
