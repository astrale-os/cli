import type { VisibilityState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { api, qk } from '@/lib/api'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { SchemaDetail } from '../detail'
import { PanelShell } from '../panel-shell'
import { WorkspaceSchemaGraph } from './graph'
import { prepareWorkspaceDomain, type WorkspaceDomainProjection } from './projection'
import { useSchemaWorkspace } from './store'
import { WorkspaceModuleTree } from './tree'
import { useWorkspaceDomainInputs, type WorkspaceDomainInput } from './use-domain-inputs'
import { WorkspaceViewsPanel } from './views-panel'

const MODULES_MIN = 220
const MODULES_MAX = 620
const MODULES_DEFAULT = 300

function domainPreparationKey(
  input: WorkspaceDomainInput,
  collapsedModules: string[],
  badgeInterfaces: string[],
): string {
  return [
    input.summary.id,
    input.summary.origin,
    input.bundle.schemaHash,
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
    badgeInterfaces.slice().sort().join(','),
  ].join('|')
}

export function WorkspaceSchemaSection({ domainIds }: { domainIds: string[] }) {
  const { data: domains } = useWorkspace()
  const { inputs, pending, errors } = useWorkspaceDomainInputs(domainIds, domains)
  const queryClient = useQueryClient()
  const activeDomainId = useUI((state) => state.domainId)
  const selected = useUI((state) => state.selectedClass)
  const select = useUI((state) => state.selectClass)
  const setFocus = useUI((state) => state.setFocus)
  const panelOverlay = useUI((state) => state.panelOverlay)
  const setPanelOverlay = useUI((state) => state.setPanelOverlay)
  const setCanvasMode = useUI((state) => state.setCanvasMode)
  const collapsedModules = useSchemaWorkspace((state) => state.collapsedModules)
  const badgeInterfaces = useSchemaWorkspace((state) => state.badgeInterfaces)
  const [prepared, setPrepared] = useState<WorkspaceDomainProjection[]>([])
  const preparedCache = useRef(
    new Map<string, { key: string; projection: WorkspaceDomainProjection }>(),
  )
  const [moduleWidth, setModuleWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem('studio.workspaceModulesWidth'))
      if (Number.isFinite(value) && value >= MODULES_MIN && value <= MODULES_MAX) return value
    } catch {}
    return MODULES_DEFAULT
  })

  useEffect(() => {
    setCanvasMode('schema')
    if (useUI.getState().panelOverlay && useUI.getState().panelOverlay !== 'views') {
      setPanelOverlay(null)
    }
  }, [setCanvasMode, setPanelOverlay])

  const preparationKey = useMemo(
    () =>
      inputs
        .map((input) =>
          domainPreparationKey(
            input,
            collapsedModules[input.summary.id] ?? [],
            badgeInterfaces[input.summary.id] ?? [],
          ),
        )
        .join('::'),
    [badgeInterfaces, collapsedModules, inputs],
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
        const badges = badgeInterfaces[domainId] ?? []
        const key = domainPreparationKey(input, collapsed, badges)
        const cached = preparedCache.current.get(domainId)
        if (cached?.key === key) return { ...cached.projection, input }
        const projection = await prepareWorkspaceDomain(input, collapsed, badges)
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

  const startModuleResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = moduleWidth
    let latest = startWidth
    const onMove = (moveEvent: PointerEvent) => {
      latest = Math.min(MODULES_MAX, Math.max(MODULES_MIN, startWidth + moveEvent.clientX - startX))
      setModuleWidth(latest)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem('studio.workspaceModulesWidth', String(latest))
      } catch {}
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const activeInput = inputs.find((input) => input.summary.id === activeDomainId)
  const viewsCount = inputs.reduce((count, input) => count + input.anatomy.views.length, 0)
  const ready = prepared.length === inputs.length && inputs.length === domainIds.length
  const providerKey = prepared
    .map((domain) => `${domain.input.summary.id}:${domain.input.bundle.schemaHash}`)
    .join('|')

  if ((pending || !ready) && errors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Composing workspace…
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
        <div className="relative min-h-0 shrink-0 border-r" style={{ width: moduleWidth }}>
          <ScrollArea className="h-full">
            <WorkspaceModuleTree domains={prepared} onToggleHidden={toggleHidden} />
          </ScrollArea>
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

        <div className="relative min-w-0 flex-1">
          <ReactFlowProvider key={providerKey}>
            <WorkspaceSchemaGraph
              domains={prepared}
              viewsCount={viewsCount}
              onToggleInherited={toggleInherited}
            />
          </ReactFlowProvider>
        </div>

        {panelOverlay === 'views' ? (
          <PanelShell onClose={() => setPanelOverlay(null)}>
            <WorkspaceViewsPanel inputs={inputs} />
          </PanelShell>
        ) : selected && activeInput ? (
          <PanelShell onClose={() => select(undefined)}>
            <SchemaDetail bundle={activeInput.bundle} selected={selected} />
          </PanelShell>
        ) : null}
      </div>
    </div>
  )
}
