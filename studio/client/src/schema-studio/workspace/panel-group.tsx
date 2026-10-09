import type { ReactNode } from 'react'

/** One domain's block in a workspace-wide overlay panel: its origin, a count, and its rows. */
export function WorkspacePanelGroup({
  domainId,
  origin,
  count,
  children,
}: {
  domainId: string
  origin: string
  count: number
  children: ReactNode
}) {
  return (
    <section data-domain-id={domainId}>
      <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
        <span className="h-2 w-2 rounded-full bg-primary/70" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{origin}</h2>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}
