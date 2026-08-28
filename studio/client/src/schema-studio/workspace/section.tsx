import type { VisibilityState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { api, qk } from '@/lib/api'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { isModuleRef } from '@/lib/targets'
import { buildViewsModel } from '@/lib/views'

import { SchemaDetail } from '../detail'
import { DomainsPanel } from '../domains-panel'
import { IntegrationsPanel } from '../integrations-panel'
import { PanelShell } from '../panel-shell'
import { ModulesSidebar } from '../sidebar'
import { viewGraphKey } from '../view-graph'
import { ViewsPanel } from '../views-panel'
import { WorkspaceSchemaGraph } from './graph'
import { prepareWorkspaceDomain, type WorkspaceDomainProjection } from './projection'
import { useSchemaWorkspace } from './store'
import { WorkspaceModuleTree } from './tree'
import { useWorkspaceDomainInputs, type WorkspaceDomainInput } from './use-domain-inputs'
import { WorkspaceViewsPanel } from './views-panel'

const MODULES_MIN = 220
const MODULES_MAX = 620
const MODULES_DEFAULT = 300

function domainPreparationKey(input: WorkspaceDomainInput, collapsedModules: string[]): string {
  return [
    input.summary.id,
    input.summary.origin,
    input.bundle.renderFingerprint,
    // views come from anatomy, which the render fingerprint does not cover
    viewGraphKey(buildViewsModel(input.anatomy, input.bundle)),
    Object.keys(input.visibility.hidden).sort().join(','),
    input.visibility.showInheritedEdges,
    Object.entries(input.layout.positions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([id, position]) =>
          `${id}:${position.x}:${position.y}:${position.w ?? ''}:${position.h ?? ''}`,
      )
      .join(','),
    collapsedModules.slice().sort().join(','),
  ].join('|')
}

export function WorkspaceSchemaSection({ domainIds }: { domainIds: string[] }) {
  const { data: domains } = useWorkspace()
  const { inputs, pending, errors } = useWorkspaceDomainInputs(domainIds, domains)
  const queryClient = useQueryClient()
  const activeDomainId = useUI((state) => state.domainId)
  const selected = useUI((state) => state.selectedClass)
  const select = useUI((state) => state.selectClass)
  const clearSelection = useUI((state) => state.clearSelection)
  const setFocus = useUI((state) => state.setFocus)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const collapsedModules = useSchemaWorkspace((state) => state.collapsedModules)
  const [prepared, setPrepared] = useState<WorkspaceDomainProjection[]>([])
  const preparedCache = useRef(
    new Map<string, { key: string; projection: WorkspaceDomainProjection }>(),
  )

  useEffect(() => {
    if (useUI.getState().panelOverlay && useUI.getState().panelOverlay !== 'views') {
      setPanelOverlay(null)
    }
  }, [setPanelOverlay])

  const preparationKey = useMemo(
    () =>
      inputs
        .map((input) => domainPreparationKey(input, collapsedModules[input.summary.id] ?? []))
        .join('::'),
    [collapsedModules, inputs],
  )

  useEffect(() => {
    let cancelled = false
    const selected = new Set(inputs.map((input) => input.summary.id))
    for (const domainId of preparedCache.current.keys()) {
      if (!selected.has(domainId)) preparedCache.current.delete(domainId)
    }
    Promise.all(
      inputs.map(async (input) => {
        const domainId = input.summary.id
        const collapsed = collapsedModules[domainId] ?? []
        const key = domainPreparationKey(input, collapsed)
        const cached = preparedCache.current.get(domainId)
        if (cached?.key === key) return { ...cached.projection, input }
        const projection = await prepareWorkspaceDomain(input, collapsed)
        if (!cancelled) preparedCache.current.set(domainId, { key, projection })
        return projection
      }),
    ).then((next) => {
      if (!cancelled) setPrepared(next)
    })
    return () => {
      cancelled = true
    }
    // preparationKey is the intentionally compact dependency for the server and local slices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparationKey])

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
    (domainId: string, ref: string) =>
      updateVisibility(domainId, (current) => {
        const hidden = { ...current.hidden }
        if (hidden[ref]) delete hidden[ref]
        else hidden[ref] = true
        return { ...current, hidden }
      }),
    [updateVisibility],
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
  // A module is a grouping, not a member: selecting one rings its box on the canvas and
  // its row in the tree, and that is the whole answer — there is no module to inspect.
  const detail = selected && !isModuleRef(selected) ? selected : undefined
  const solo = inputs.length === 1
  const ready = prepared.length === inputs.length && inputs.length === domainIds.length
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
        <ModulesSidebar onClearSelection={clearSelection}>
          <ScrollArea className="h-full">
            <WorkspaceModuleTree domains={prepared} onToggleHidden={toggleHidden} />
          </ScrollArea>
        </ModulesSidebar>

        <div className="relative min-w-0 flex-1">
          <ReactFlowProvider key={providerKey}>
            <WorkspaceSchemaGraph domains={prepared} onToggleInherited={toggleInherited} />
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
            <DomainsPanel domainId={activeInput.summary.id} />
          </PanelShell>
        ) : panelOverlay === 'integrations' && activeInput ? (
          <PanelShell onClose={() => setPanelOverlay(null)}>
            <IntegrationsPanel domainId={activeInput.summary.id} />
          </PanelShell>
        ) : detail && activeInput ? (
          <PanelShell onClose={() => select(undefined)}>
            <SchemaDetail bundle={activeInput.bundle} selected={detail} />
          </PanelShell>
        ) : null}
      </div>
    </div>
  )
}
