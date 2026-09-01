import type { VisibilityState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { api, qk } from '@/lib/api'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { isModuleRef } from '@/lib/targets'
import { buildViewsModel } from '@/lib/views'

import { SchemaDetail } from '../detail'
import { DomainsPanel } from '../domains-panel'
import { DomainsRailHeader } from '../domains-rail'
import { IntegrationsPanel } from '../integrations-panel'
import { PanelShell } from '../panel-shell'
import { ModulesSidebar } from '../sidebar'
import { ViewsPanel } from '../views-panel'
import { toggleVisibilityRef } from '../visibility'
import { WorkspaceSchemaGraph } from './graph'
import { useSchemaWorkspace } from './store'
import { WorkspaceDomainTree } from './tree'
import { useWorkspaceDomainInputs } from './use-domain-inputs'
import { usePreparedWorkspaceDomains } from './use-prepared-domains'
import { WorkspaceViewsPanel } from './views-panel'

export function WorkspaceSchemaSection({ domainIds }: { domainIds: string[] }) {
  const { data: domains } = useWorkspace()
  const { inputs, pending, errors } = useWorkspaceDomainInputs(domainIds, domains)
  const queryClient = useQueryClient()
  const activeDomainId = useUI((state) => state.domainId)
  const selected = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  const select = useUI((state) => state.selectClass)
  const clearSelection = useUI((state) => state.clearSelection)
  const setFocus = useUI((state) => state.setFocus)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const revealOnCanvas = useUI((state) => state.revealOnCanvas)
  const collapsedModules = useSchemaWorkspace((state) => state.collapsedModules)
  const hiddenDomainIds = useSchemaWorkspace((state) => state.hiddenDomainIds)
  const { domains: prepared, ready: preparationReady } = usePreparedWorkspaceDomains(
    inputs,
    collapsedModules,
  )
  // A domain put away by the rail's eye keeps its projection — its hierarchy stays in the
  // rail, and showing it again costs no re-layout — but the canvas is told not to draw it.
  // Same array back when nothing is hidden: the graph reads that identity to tell a real
  // change from the echo of its own drag.
  const canvasDomains = useMemo(() => {
    if (hiddenDomainIds.length === 0) return prepared
    const hidden = new Set(hiddenDomainIds)
    return prepared.map((domain) =>
      hidden.has(domain.input.summary.id) ? { ...domain, hidden: true } : domain,
    )
  }, [hiddenDomainIds, prepared])

  useEffect(() => {
    if (useUI.getState().panelOverlay && useUI.getState().panelOverlay !== 'views') {
      setPanelOverlay(null)
    }
  }, [setPanelOverlay])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setFocus(null)
      select(undefined)
      setPanelOverlay(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [select, setFocus, setPanelOverlay])

  const updateVisibility = useCallback(
    (domainId: string, update: (current: VisibilityState) => VisibilityState) => {
      const input = inputs.find((candidate) => candidate.summary.id === domainId)
      if (!input) return
      const next = update(input.visibility)
      queryClient.setQueryData(qk.visibility(domainId), next)
      void api.setVisibility(domainId, next).catch(() => {
        void queryClient.invalidateQueries({ queryKey: qk.visibility(domainId) })
      })
    },
    [inputs, queryClient],
  )

  const toggleHidden = useCallback(
    (domainId: string, ref: string) => {
      // Un-hiding has to land somewhere the reader can see. The canvas culls what sits
      // off-screen, and an imported domain's frame is placed past the last domain box —
      // so restoring one from the panel otherwise looks like the eye did nothing at all.
      const wasHidden =
        inputs.find((candidate) => candidate.summary.id === domainId)?.visibility.hidden[ref] ===
        true
      updateVisibility(domainId, (current) => toggleVisibilityRef(current, ref))
      if (wasHidden) revealOnCanvas(ref)
    },
    [inputs, revealOnCanvas, updateVisibility],
  )

  const toggleInherited = useCallback(() => {
    const nextValue = !inputs.every((input) => input.visibility.showInheritedEdges)
    for (const input of inputs) {
      updateVisibility(input.summary.id, (current) => ({
        ...current,
        showInheritedEdges: nextValue,
      }))
    }
  }, [inputs, updateVisibility])

  const activeInput = inputs.find((input) => input.summary.id === activeDomainId)
  // The detail panel answers to the SELECTION, not to the active domain: on a canvas of
  // several domains, clicking a class in any of them opens that class — the one you
  // clicked, from the schema that declares it.
  const selectionInput =
    inputs.find((input) => input.summary.id === selectionDomainId) ?? activeInput
  // A module is a grouping, not a member: selecting one rings its box on the canvas and
  // its row in the tree, and that is the whole answer — there is no module to inspect.
  const detail = selected && !isModuleRef(selected) ? selected : undefined
  const solo = inputs.length === 1
  const ready = preparationReady && inputs.length === domainIds.length
  const providerKey = prepared
    .map((domain) => `${domain.input.summary.id}:${domain.input.bundle.renderFingerprint}`)
    .join('|')

  if ((pending || !ready) && errors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {/* `inputs` is still empty here, so the count of domains ASKED for is what knows */}
        {domainIds.length === 1 ? 'Introspecting schema…' : 'Composing workspace…'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="workspace-schema-section">
      {(errors.length > 0 || inputs.some((input) => input.bundle.error)) && (
        <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {[...errors, ...inputs.flatMap((input) => input.bundle.error?.message ?? [])].join(' ')}
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ModulesSidebar onClearSelection={clearSelection} header={<DomainsRailHeader />}>
          <ScrollArea className="h-full">
            <WorkspaceDomainTree domains={prepared} onToggleHidden={toggleHidden} />
          </ScrollArea>
        </ModulesSidebar>

        <div className="relative min-w-0 flex-1">
          <ReactFlowProvider key={providerKey}>
            <WorkspaceSchemaGraph domains={canvasDomains} onToggleInherited={toggleInherited} />
          </ReactFlowProvider>
        </div>

        {panelOverlay === 'views' ? (
          <PanelShell onClose={() => setPanelOverlay(null)}>
            {solo && activeInput ? (
              <ViewsPanel
                domainId={activeInput.summary.id}
                model={buildViewsModel(activeInput.anatomy, activeInput.bundle)}
              />
            ) : (
              <WorkspaceViewsPanel inputs={inputs} />
            )}
          </PanelShell>
        ) : panelOverlay === 'domains' && activeInput ? (
          <PanelShell onClose={() => setPanelOverlay(null)}>
            <DomainsPanel
              domainId={activeInput.summary.id}
              visibility={activeInput.visibility}
              onToggleHidden={(ref) => toggleHidden(activeInput.summary.id, ref)}
            />
          </PanelShell>
        ) : panelOverlay === 'integrations' && activeInput ? (
          <PanelShell onClose={() => setPanelOverlay(null)}>
            <IntegrationsPanel domainId={activeInput.summary.id} />
          </PanelShell>
        ) : detail && selectionInput ? (
          <PanelShell onClose={() => select(undefined)}>
            <SchemaDetail bundle={selectionInput.bundle} selected={detail} />
          </PanelShell>
        ) : null}
      </div>
    </div>
  )
}
