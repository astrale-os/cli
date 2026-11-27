import { AppWindow, TriangleAlert } from 'lucide-react'

import { EmptyState } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/scroll-area'
import { buildViewsModel } from '@/lib/views'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { ViewRow } from '../views-panel'

/** The views of every domain on the canvas, one block per domain. */
export function WorkspaceViewsPanel({ inputs }: { inputs: WorkspaceDomainInput[] }) {
  const groups = inputs.map((input) => {
    const domainId = input.summary.id
    const model = buildViewsModel(input.anatomy, input.bundle)
    return {
      input,
      drift: model.hasDrift,
      rows: model.all.map((view) => <ViewRow key={view.slug} domainId={domainId} view={view} />),
    }
  })
  const count = groups.reduce((total, group) => total + group.rows.length, 0)

  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Workspace views</h1>
          <span className="text-xs text-muted-foreground">{count}</span>
          {groups.some((group) => group.drift) && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
              <TriangleAlert className="h-3.5 w-3.5" /> drift
            </span>
          )}
        </div>

        {count === 0 && (
          <EmptyState
            icon={<AppWindow />}
            title="No views"
            hint="The selected domains declare no views."
          />
        )}

        <div className="space-y-7">
          {groups
            .filter((group) => group.rows.length > 0)
            .map(({ input, rows }) => (
              <section key={input.summary.id} data-domain-id={input.summary.id}>
                <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                  <span className="h-2 w-2 rounded-full bg-primary/70" />
                  <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {input.summary.origin}
                  </h2>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                    {rows.length}
                  </span>
                </div>
                <div className="space-y-0.5">{rows}</div>
              </section>
            ))}
        </div>
      </div>
    </ScrollArea>
  )
}
