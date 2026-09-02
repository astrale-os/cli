import type { StudioDataset, StudioDatasetFailure } from '@shared/types'

import { AlertTriangle, Check, Database } from 'lucide-react'

import { cn } from '@/lib/utils'

import { datasetLabel } from './model'

/** The rail's first Data question: WHICH Dataset the canvas draws. */
export function DatasetPicker({
  datasets,
  selectedId,
  onSelect,
}: {
  datasets: (StudioDataset | StudioDatasetFailure)[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="text-sm py-2 border-b">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Database className="h-3.5 w-3.5" /> Datasets
      </div>
      {datasets.length === 0 ? (
        <p className="px-3 pt-1 pb-2 text-[12px] text-muted-foreground">
          No Dataset referenced. Declare demo data under <code>tests/</code> and reference it from{' '}
          <code>astrale.config.ts</code>:{' '}
          <code>
            tests: tests({'{'} datasets: [dataset('./tests/datasets/demo.ts')] {'}'})
          </code>
        </p>
      ) : (
        datasets.map((entry) =>
          entry.status === 'ready' ? (
            <button
              key={entry.path}
              type="button"
              data-dataset-id={entry.id}
              aria-pressed={entry.id === selectedId}
              onClick={() => onSelect(entry.id)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-accent',
                entry.id === selectedId && 'bg-accent',
              )}
              title={entry.description ?? entry.path}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primary">
                {entry.id === selectedId ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {datasetLabel(entry)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {entry.nodes.length} nodes · {entry.edges.length} edges
                  {entry.schemaMatch ? '' : ' · stale schema'}
                </span>
              </span>
            </button>
          ) : (
            <div
              key={entry.path}
              className="flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left"
              title={entry.error.message}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{entry.path}</span>
                <span className="block text-[11px] text-warning line-clamp-2">
                  {entry.error.message}
                </span>
              </span>
            </div>
          ),
        )
      )}
    </div>
  )
}
