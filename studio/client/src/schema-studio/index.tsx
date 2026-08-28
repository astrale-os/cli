import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
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
import { PanelShell } from './panel-shell'
import { ModuleTree } from './tree'
import { ViewsPanel } from './views-panel'
import { WorkspaceSchemaSection } from './workspace/section'
import { useSchemaWorkspace } from './workspace/store'

/** Modules sidebar width bounds (px). Default mirrors the old fixed `w-60` (15rem). */
const MODULES_MIN = 180
const MODULES_MAX = 560
const MODULES_DEFAULT = 240

/** Which canvas this section shows: the schema graph, or the core (genesis) data. */
export type SchemaMode = 'schema' | 'core'

export function SchemaSection({
  domainId,
  mode = 'schema',
}: {
  domainId: string
  mode?: SchemaMode
}) {
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const workspaceIds = selectedDomainIds.includes(domainId)
    ? selectedDomainIds
    : [domainId, ...selectedDomainIds]
  // Core is a reading of ONE domain's genesis data; a multi-domain workspace has no
  // such thing, so the Core tab always falls back to the active domain.
  if (mode === 'schema' && workspaceIds.length > 1)
    return <WorkspaceSchemaSection domainIds={workspaceIds} />
  return <SingleDomainSchemaSection domainId={domainId} mode={mode} />
}

function SingleDomainSchemaSection({ domainId, mode }: { domainId: string; mode: SchemaMode }) {
  const { data: bundle, isLoading } = useBundle(domainId)
  const { data: layout } = useLayout(domainId)
  const { data: core } = useCore(domainId)
  const selected = useUI((s) => s.selectedClass)
  const select = useUI((s) => s.selectClass)
  const setFocus = useUI((s) => s.setFocus)
  const coreMode = mode === 'core'
  const panelOverlay = useUI((s) => s.panelOverlay)
  const setPanelOverlay = useUI((s) => s.setPanelOverlay)
  const viewsModel = useViewsModel(domainId)

  // Resizable modules sidebar — width persists across sessions (localStorage),
  // clamped so it can't collapse the canvas or swallow the panel.
  const [moduleWidth, setModuleWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem('studio.modulesWidth'))
      if (Number.isFinite(v) && v >= MODULES_MIN && v <= MODULES_MAX) return v
    } catch {}
    return MODULES_DEFAULT
  })
  const startModuleResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = moduleWidth
    let latest = startW
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(MODULES_MAX, Math.max(MODULES_MIN, startW + (ev.clientX - startX)))
      setModuleWidth(latest)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem('studio.modulesWidth', String(latest))
      } catch {}
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // core-view selection (a genesis node path) — local to this section, reset when
  // the domain or canvas mode changes so re-entering Core starts cleared.
  const [corePath, setCorePath] = useState<string | null>(null)
  useEffect(() => setCorePath(null), [domainId, mode])

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
          <div className="relative border-r shrink-0 min-h-0" style={{ width: moduleWidth }}>
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
            {/* drag handle straddling the right border — resize the modules sidebar */}
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={startModuleResize}
              title="Drag to resize"
              className="group absolute right-0 top-0 z-20 h-full w-1.5 translate-x-1/2 cursor-col-resize"
            >
              <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/50" />
            </div>
          </div>
          <div className="flex-1 min-w-0 relative">
            {/* Key the provider per domain+mode so ReactFlow's internal store is FRESH on every
                switch. Without this the store persists across a domain switch (only the inner
                canvas remounts), and feeding the new domain's nodes — notably a materialized
                interface node — into a stale store (with a queued fitView) drives a setNodes-
                during-commit loop → React #185 blank screen. A keyed provider makes a switch
                behave exactly like a working fresh load. */}
            <ReactFlowProvider key={`${domainId}:${mode}`}>
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
