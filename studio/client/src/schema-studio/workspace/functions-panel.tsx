import { Braces } from 'lucide-react'

import { EmptyState } from '@/components/studio-kit'
import { ScrollArea } from '@/components/ui/misc'
import { buildFunctionsModel } from '@/lib/functions'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { FunctionRow } from '../functions-panel'

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
              <section key={input.summary.id} data-domain-id={input.summary.id}>
                <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                  <span className="h-2 w-2 rounded-full bg-primary/70" />
                  <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {input.summary.origin}
                  </h2>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                    {model.all.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {model.all.map((fn) => (
                    <FunctionRow
                      key={`${input.summary.id}:${fn.name}`}
                      domainId={input.summary.id}
                      fn={fn}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </ScrollArea>
  )
}
