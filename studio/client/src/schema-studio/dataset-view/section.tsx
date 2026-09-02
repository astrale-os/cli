import { ReactFlowProvider } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ScrollArea } from '@/components/ui/misc'
import { useBundle, useDatasets } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { CoreDetail, CoreView } from '../core-view'
import { DomainPicker, DomainsRailHeader } from '../domains-rail'
import { PanelShell } from '../panel-shell'
import { ModulesSidebar } from '../sidebar'
import { datasetCore, isReadyDataset } from './model'
import { DatasetPicker } from './picker'
import { DatasetTree } from './tree'

/**
 * The demo-data reading of ONE domain: the Datasets its project references, drawn with the
 * Core canvas. Datasets are extracted on demand and never deployed, so this section reads a
 * separate query and stays alive when a Dataset module is broken — the rail says which one.
 */
export function DataSection({ domainId }: { domainId: string }) {
  const { data: bundle, isLoading } = useBundle(domainId)
  const { data: datasets, isLoading: extracting } = useDatasets(domainId)
  const setFocus = useUI((s) => s.setFocus)
  const select = useUI((s) => s.selectClass)

  // Which Dataset, and which of its Nodes — local to this section, cleared with the domain.
  const [datasetId, setDatasetId] = useState<string | null>(null)
  const [nodePath, setNodePath] = useState<string | null>(null)
  useEffect(() => {
    setDatasetId(null)
    setNodePath(null)
  }, [domainId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setFocus(null)
      select(undefined)
      setNodePath(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setFocus, select])

  const entries = useMemo(() => datasets?.datasets ?? [], [datasets])
  const ready = useMemo(() => entries.filter(isReadyDataset), [entries])
  const selected = ready.find((entry) => entry.id === datasetId) ?? ready[0] ?? null
  const core = useMemo(() => (selected ? datasetCore(selected) : null), [selected])

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
          <span>{bundle.error.message}</span>
        </div>
      )}
      {selected && !selected.schemaMatch && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/30 text-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Dataset “{selected.title ?? selected.id}” was admitted against another schema revision;
            it is re-extracted once the schema settles.
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <ModulesSidebar onClearSelection={() => setNodePath(null)} header={<DomainsRailHeader />}>
          <ScrollArea className="h-full">
            <DomainPicker>
              {datasets ? (
                <DatasetPicker
                  datasets={entries}
                  selectedId={selected?.id ?? null}
                  onSelect={(id) => {
                    setDatasetId(id)
                    setNodePath(null)
                  }}
                />
              ) : (
                <p className="px-3 py-2 text-[12px] text-muted-foreground">
                  {extracting ? 'Extracting datasets…' : 'Datasets unavailable.'}
                </p>
              )}
              {selected && core && (
                <DatasetTree
                  dataset={selected}
                  core={core}
                  bundle={bundle}
                  selectedPath={nodePath}
                  onSelect={setNodePath}
                />
              )}
            </DomainPicker>
          </ScrollArea>
        </ModulesSidebar>
        <div className="flex-1 min-w-0 relative">
          {/* One ReactFlow store per domain AND Dataset: switching either must start fresh. */}
          <ReactFlowProvider key={`${domainId}:${selected?.id ?? ''}`}>
            {core ? (
              <CoreView
                core={core}
                bundle={bundle}
                selectedPath={nodePath}
                onSelect={setNodePath}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-6 text-center">
                {!datasets
                  ? 'Extracting datasets…'
                  : entries.length === 0
                    ? 'No Dataset referenced by this project.'
                    : 'No Dataset could be extracted; see the rail for details.'}
              </div>
            )}
          </ReactFlowProvider>
        </div>
        {nodePath && core && (
          <PanelShell onClose={() => setNodePath(null)}>
            <CoreDetail core={core} bundle={bundle} selectedPath={nodePath} />
          </PanelShell>
        )}
      </div>
    </div>
  )
}
