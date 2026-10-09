import { Braces } from 'lucide-react'

import { EmptyState } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/misc'
import { buildFunctionsModel } from '@/lib/functions'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { FunctionRow } from '../functions-panel'
import { WorkspacePanelGroup } from './panel-group'

export function WorkspaceFunctionsPanel({ inputs }: { inputs: WorkspaceDomainInput[] }) {
  const groups = inputs.map((input) => ({ input, model: buildFunctionsModel(input.bundle) }))
  const count = groups.reduce((total, group) => total + group.model.all.length, 0)

  return (
    <ScrollArea className="h-full" data-testid="workspace-functions-panel">
      <div className="p-5">
        <div className="mb-5 flex items-baseline gap-2 pr-8">
          <h1 className="text-base font-semibold">Workspace functions</h1>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>

        {count === 0 && (
          <EmptyState
            icon={<Braces />}
            title="No functions"
            hint="The selected domains declare no standalone functions."
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
                {model.all.map((fn) => (
                  <FunctionRow
                    key={`${input.summary.id}:${fn.name}`}
                    domainId={input.summary.id}
                    fn={fn}
                  />
                ))}
              </WorkspacePanelGroup>
            ))}
        </div>
      </div>
    </ScrollArea>
  )
}
