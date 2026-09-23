import { AppWindow, TriangleAlert } from 'lucide-react'

import { EmptyState } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/misc'
import { buildViewsModel } from '@/lib/views'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { ViewRow } from '../views-panel'
import { WorkspacePanelGroup } from './panel-group'

export function WorkspaceViewsPanel({ inputs }: { inputs: WorkspaceDomainInput[] }) {
  const groups = inputs.map((input) => ({
    input,
    model: buildViewsModel(input.anatomy, input.bundle),
  }))
  const count = groups.reduce((total, group) => total + group.model.all.length, 0)
  const hasDrift = groups.some((group) => group.model.hasDrift)

  return (
    <ScrollArea className="h-full" data-testid="workspace-views-panel">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Workspace views</h1>
          <span className="text-xs text-muted-foreground">{count}</span>
          {hasDrift && (
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
            .filter((group) => group.model.all.length > 0)
            .map(({ input, model }) => (
              <WorkspacePanelGroup
                key={input.summary.id}
                domainId={input.summary.id}
                origin={input.summary.origin}
                count={model.all.length}
              >
                {model.all.map((view) => (
                  <ViewRow
                    key={`${input.summary.id}:${view.slug}`}
                    domainId={input.summary.id}
                    view={view}
                    icon={
                      view.boundClass ? input.bundle.ir?.classes[view.boundClass]?.icon : undefined
                    }
                  />
                ))}
              </WorkspacePanelGroup>
            ))}
        </div>
      </div>
    </ScrollArea>
  )
}
