import { ChevronDown, ChevronRight, Layers3 } from 'lucide-react'
import { useState } from 'react'

import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { WorkspaceDomainProjection } from './projection'

import { buildModuleTree } from '../modules'
import { ModuleTree, type ModuleTreeControls } from '../tree'
import { useSchemaWorkspace } from './store'

export function WorkspaceModuleTree({
  domains,
  onToggleHidden,
}: {
  domains: WorkspaceDomainProjection[]
  onToggleHidden: (domainId: string, ref: string) => void
}) {
  const activeDomainId = useUI((state) => state.domainId)
  const selected = useUI((state) => state.selectedClass)
  const setDomain = useUI((state) => state.setDomain)
  const collapsedByDomain = useSchemaWorkspace((state) => state.collapsedModules)
  const badgeByDomain = useSchemaWorkspace((state) => state.badgeInterfaces)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const toggleInterface = useSchemaWorkspace((state) => state.toggleInterface)
  const [closedDomains, setClosedDomains] = useState<Record<string, true>>({})

  const activate = (domainId: string, ref?: string) => {
    if (useUI.getState().domainId !== domainId) setDomain(domainId)
    if (ref) useUI.getState().selectClass(ref)
  }

  return (
    <div className="py-2" data-testid="workspace-module-tree">
      <div className="flex items-center gap-1.5 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Layers3 className="h-3 w-3" /> Workspace modules
      </div>
      {domains.map((domain) => {
        const domainId = domain.input.summary.id
        const active = activeDomainId === domainId
        const closed = !!closedDomains[domainId]
        const materializedInterfaces = Object.fromEntries(
          Object.keys(domain.input.bundle.ir?.interfaces ?? {})
            .filter((name) => !(badgeByDomain[domainId] ?? []).includes(name))
            .map((name) => [name, true]),
        ) as Record<string, true>
        const controls: ModuleTreeControls = {
          domainId,
          collapsedModules: collapsedByDomain[domainId] ?? [],
          hidden: domain.input.visibility.hidden,
          materializedInterfaces,
          toggleModule: (path) => toggleModule(domainId, path),
          toggleHidden: (ref) => onToggleHidden(domainId, ref),
          toggleInterfaceMaterialized: (name) => toggleInterface(domainId, name),
        }
        const tree = buildModuleTree(domain.input.bundle)

        return (
          <section key={domainId} className="border-b border-border/40 last:border-b-0">
            <div
              data-domain-id={domainId}
              className={cn(
                'flex items-center gap-1 px-2 py-2 transition-colors',
                active ? 'bg-sky-400/[0.075]' : 'hover:bg-accent/30',
              )}
            >
              <button
                type="button"
                onClick={() =>
                  setClosedDomains((current) => {
                    const next = { ...current }
                    if (next[domainId]) delete next[domainId]
                    else next[domainId] = true
                    return next
                  })
                }
                className="rounded p-0.5 text-muted-foreground hover:bg-white/5"
                title={closed ? 'Expand domain' : 'Collapse domain'}
              >
                {closed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => activate(domainId)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-extrabold"
                title={`Make ${domain.input.summary.origin} active`}
              >
                {domain.input.summary.origin}
              </button>
              {active && <span className="h-1.5 w-1.5 rounded-full bg-sky-300" title="Active" />}
            </div>
            {!closed && (
              <div className="border-t border-border/25 bg-background/15">
                <ModuleTree
                  root={tree}
                  selected={active ? selected : undefined}
                  onSelect={(ref) => activate(domainId, ref)}
                  controls={controls}
                />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
