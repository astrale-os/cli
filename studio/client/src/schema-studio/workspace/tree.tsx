import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { WorkspaceDomainProjection } from './projection'

import { buildModuleTree } from '../modules'
import { ModuleTree, type ModuleTreeControls } from '../tree'
import { useSchemaWorkspace } from './store'

export function shouldShowDomainSelectionIndicator({
  active,
  closed,
  selected,
}: {
  active: boolean
  closed: boolean
  selected?: string
}): boolean {
  return active && closed && selected !== undefined
}

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
      {domains.map((domain) => {
        const domainId = domain.input.summary.id
        const active = activeDomainId === domainId
        const closed = !!closedDomains[domainId]
        const showSelectionIndicator = shouldShowDomainSelectionIndicator({
          active,
          closed,
          selected,
        })
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
            {/* The accent spine identifies the active domain. When its hierarchy is closed,
                the dot keeps a selection hidden inside it discoverable. */}
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
              {showSelectionIndicator && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  title="Selected element in collapsed domain"
                />
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
