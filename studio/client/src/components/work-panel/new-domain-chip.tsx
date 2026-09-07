/** The durable first page of a chat opened while scaffolding a domain. */
import type { NewDomainContext } from '@shared/types'

import { Box } from 'lucide-react'

export function NewDomainChip({ domain }: { domain: NewDomainContext }) {
  return (
    <div
      data-testid="new-domain-context"
      className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-2.5 py-2"
    >
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Box className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 text-[11px] leading-4">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground">New domain</span>
          <span className="truncate font-mono text-foreground/80">{domain.origin}</span>
        </div>
        <div className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground">
          <span className="shrink-0 font-mono">{domain.path}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">This chat is its creation brief</span>
        </div>
      </div>
    </div>
  )
}
