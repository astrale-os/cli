import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { useBundle, useCore } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { CoreDetail, CoreTree, CoreView } from './core-view'
import { TestsSection } from './dataset-view/section'
import { DomainPicker, DomainsRailHeader } from './domains-rail'
import { PanelShell } from './panel-shell'
import { ModulesSidebar } from './sidebar'
import { WorkspaceSchemaSection } from './workspace/section'
import { uniqueDomainIds, useSchemaWorkspace } from './workspace/store'

/** Which canvas this section shows: the schema graph, the core (genesis) data, or the test data. */
export type SchemaMode = 'schema' | 'core' | 'tests'

/**
 * The schema studio. ONE canvas draws the schema, whether it holds one domain or
 * several — a lone domain is simply a workspace of one, so every canvas affordance
 * (focus, comments, views, auto-arrange) exists in a single place instead of being
 * ported between two hosts that drifted apart. Core is a different reading of one
 * domain's genesis data and keeps its own, much smaller, section.
 */
export function SchemaSection({
  domainId,
  onDomainChange,
  mode = 'schema',
}: {
  /** Local scope for Core/Tests only; it has no effect on the workspace agent. */
  domainId?: string
  onDomainChange: (domainId: string) => void
  mode?: SchemaMode
}) {
  const visibleDomainIds = useSchemaWorkspace((state) => state.visibleDomainIds)
  if (mode === 'core')
    return domainId ? (
      <CoreSection domainId={domainId} onDomainChange={onDomainChange} />
    ) : (
      <NoDomain />
    )
  if (mode === 'tests')
    return domainId ? (
      <TestsSection domainId={domainId} onDomainChange={onDomainChange} />
    ) : (
      <NoDomain />
    )
  return <WorkspaceSchemaSection domainIds={uniqueDomainIds(visibleDomainIds)} />
}

/** The core (genesis) reading of ONE domain: its data tree, canvas and detail. */
function CoreSection({
  domainId,
  onDomainChange,
}: {
  domainId: string
  onDomainChange: (domainId: string) => void
}) {
  const { data: bundle, isLoading } = useBundle(domainId)
  const { data: core } = useCore(domainId)
  const setFocus = useUI((s) => s.setFocus)
  const select = useUI((s) => s.selectClass)

  // a genesis node path — local to this section, cleared when the domain changes
  const [corePath, setCorePath] = useState<string | null>(null)
  useEffect(() => setCorePath(null), [domainId])

  // Esc clears the selection (which hides the detail panel), unless a Radix overlay
  // (popover / dialog / command palette) already consumed the Esc.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setFocus(null)
      select(undefined)
      setCorePath(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setFocus, select])

  if (isLoading || !bundle) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Introspecting schema…
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {bundle.error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/30 text-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {bundle.error.message}
            {!bundle.depsInstalled &&
              ' — showing the static structure; run `pnpm install` in the domain for full fidelity.'}
          </span>
        </div>
      )}

      {!bundle.ir ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-6 text-center">
          No compiled schema available.
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Core reads ONE domain, so its rail is the same list of domains with no
              canvas composition to make — the genesis tree hangs under the selected one. */}
          <ModulesSidebar onClearSelection={() => setCorePath(null)} header={<DomainsRailHeader />}>
            <ScrollArea className="h-full">
              <DomainPicker selectedId={domainId} onSelect={onDomainChange}>
                {core && (
                  <CoreTree
                    domainId={domainId}
                    core={core}
                    bundle={bundle}
                    selectedPath={corePath}
                    onSelect={setCorePath}
                  />
                )}
              </DomainPicker>
            </ScrollArea>
          </ModulesSidebar>
          <div className="flex-1 min-w-0 relative">
            {/* Key the provider per domain so ReactFlow's internal store is FRESH on every
                switch. Without this the store persists across a domain switch (only the inner
                canvas remounts), and feeding the new domain's nodes into a stale store (with a
                queued fitView) drives a setNodes-during-commit loop → React #185 blank screen. */}
            <ReactFlowProvider key={domainId}>
              {core ? (
                <CoreView
                  domainId={domainId}
                  core={core}
                  bundle={bundle}
                  selectedPath={corePath}
                  onSelect={setCorePath}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Extracting core…
                </div>
              )}
            </ReactFlowProvider>
          </div>
          {corePath && core && (
            <PanelShell onClose={() => setCorePath(null)}>
              <CoreDetail domainId={domainId} core={core} bundle={bundle} selectedPath={corePath} />
            </PanelShell>
          )}
        </div>
      )}
    </div>
  )
}

function NoDomain() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      This workspace has no domain yet.
    </div>
  )
}
