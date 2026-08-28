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
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const [closedDomains, setClosedDomains] = useState<Record<string, true>>({})

  const activate = (domainId: string, ref?: string) => {
    if (useUI.getState().domainId !== domainId) setDomain(domainId)
    if (ref) useUI.getState().selectClass(ref)
  }

  // One domain needs no domain rail: the sidebar IS that domain's modules. The
  // per-domain header only earns its row once there is a second domain to pick.
  if (domains.length === 1) {
    const domain = domains[0]!
    const domainId = domain.input.summary.id
    return (
      <div data-domain-id={domainId} data-testid="workspace-module-tree">
        <ModuleTree
          root={buildModuleTree(domain.input.bundle)}
          selected={selected}
          onSelect={(ref) => activate(domainId, ref)}
          controls={{
            domainId,
            collapsedModules: collapsedByDomain[domainId] ?? [],
            hidden: domain.input.visibility.hidden,
            toggleModule: (path) => toggleModule(domainId, path),
            toggleHidden: (ref) => onToggleHidden(domainId, ref),
          }}
        />
      </div>
    )
  }

  return (
    <div className="py-2" data-testid="workspace-module-tree">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Layers3 className="h-3 w-3" /> Workspace modules
      </div>
      {domains.map((domain) => {
        const domainId = domain.input.summary.id
        const active = activeDomainId === domainId
        const closed = !!closedDomains[domainId]
        const controls: ModuleTreeControls = {
          domainId,
          collapsedModules: collapsedByDomain[domainId] ?? [],
          hidden: domain.input.visibility.hidden,
          toggleModule: (path) => toggleModule(domainId, path),
          toggleHidden: (ref) => onToggleHidden(domainId, ref),
        }
        const tree = buildModuleTree(domain.input.bundle)

        return (
          <section key={domainId} className="border-b border-border last:border-b-0">
            {/* The canvas no longer repaints a frame to say which domain you are in — this
                row is the one place that answers it, so it says so unmistakably: an accent
                spine, the origin in full weight, and a dot. */}
            <div
              data-domain-id={domainId}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'relative flex items-center gap-1 px-2 py-2 transition-colors',
                active
                  ? 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
                  : 'hover:bg-accent/60',
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
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
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
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-[12px]',
                  active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                )}
                title={`Make ${domain.input.summary.origin} active`}
              >
                {domain.input.summary.origin}
              </button>
              {active && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Active domain" />
              )}
            </div>
            {!closed && (
              <div className="border-t border-border bg-muted/40">
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
