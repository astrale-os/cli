import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { useBundle, useCore, useLayout, useViewsModel } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { CoreDetail, CoreTree, CoreView } from './core-view'
import { SchemaDetail } from './detail'
import { DomainsPanel } from './domains-panel'
import { SchemaGraph } from './graph'
import { IntegrationsPanel } from './integrations-panel'
import { buildModuleTree } from './modules'
import { ModuleTree } from './tree'
import { ViewsPanel } from './views-panel'

export function SchemaSection({ domainId }: { domainId: string }) {
  const { data: bundle, isLoading } = useBundle(domainId)
  const { data: layout } = useLayout(domainId)
  const { data: core } = useCore(domainId)
  const selected = useUI((s) => s.selectedClass)
  const select = useUI((s) => s.selectClass)
  const setFocus = useUI((s) => s.setFocus)
  const canvasMode = useUI((s) => s.canvasMode)
  const coreMode = canvasMode === 'core'
  const panelOverlay = useUI((s) => s.panelOverlay)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)
  const viewsModel = useViewsModel(domainId)

  // core-view selection (a genesis node path) — local to this section, reset when
  // the domain or canvas mode changes so re-entering Core starts cleared.
  const [corePath, setCorePath] = useState<string | null>(null)
  useEffect(() => setCorePath(null), [domainId, canvasMode])

  // Esc clears graph focus + selection (the latter hides the detail panel), unless
  // a Radix overlay (popover / dialog / command palette) already consumed the Esc.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setFocus(null)
      select(undefined)
      setCorePath(null)
      setPanelOverlay(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setFocus, select, setPanelOverlay])

  const tree = useMemo(() => (bundle?.ir ? buildModuleTree(bundle) : null), [bundle])

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
          <div className="w-60 border-r shrink-0 min-h-0">
            <ScrollArea className="h-full">
              {coreMode
                ? core && (
                    <CoreTree
                      core={core}
                      bundle={bundle}
                      selectedPath={corePath}
                      onSelect={setCorePath}
                    />
                  )
                : tree && <ModuleTree root={tree} selected={selected} onSelect={select} />}
            </ScrollArea>
          </div>
          <div className="flex-1 min-w-0 relative">
            <ReactFlowProvider>
              {coreMode ? (
                core ? (
                  <CoreView
                    core={core}
                    bundle={bundle}
                    selectedPath={corePath}
                    onSelect={setCorePath}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Extracting core…
                  </div>
                )
              ) : (
                <SchemaGraph
                  key={domainId}
                  bundle={bundle}
                  domainId={domainId}
                  saved={layout?.positions}
                />
              )}
            </ReactFlowProvider>
          </div>
          {coreMode ? (
            corePath &&
            core && (
              <PanelShell onClose={() => setCorePath(null)}>
                <CoreDetail core={core} bundle={bundle} selectedPath={corePath} />
              </PanelShell>
            )
          ) : panelOverlay === 'views' ? (
            <PanelShell onClose={() => setPanelOverlay(null)}>
              <ViewsPanel domainId={domainId} model={viewsModel} />
            </PanelShell>
          ) : panelOverlay === 'domains' ? (
            <PanelShell onClose={() => setPanelOverlay(null)}>
              <DomainsPanel domainId={domainId} />
            </PanelShell>
          ) : panelOverlay === 'integrations' ? (
            <PanelShell onClose={() => setPanelOverlay(null)}>
              <IntegrationsPanel domainId={domainId} />
            </PanelShell>
          ) : selected ? (
            <PanelShell onClose={() => select(undefined)}>
              <SchemaDetail bundle={bundle} selected={selected} />
            </PanelShell>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** The right-side panel chrome: fixed width, left border, a top-right close button. */
function PanelShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="w-[420px] border-l bg-card/30 shrink-0 min-h-0 relative">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        title="Close (Esc)"
        className="absolute right-3.5 top-3.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  )
}
