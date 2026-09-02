import type { StudioDataset, StudioDatasetFailure } from '@shared/types'

import { AlertTriangle, Circle, CircleDot, Database } from 'lucide-react'

import { cn } from '@/lib/utils'

import { datasetLabel } from './model'

/**
 * The rail's first Tests question: WHICH Dataset the canvas draws. One radio row per Dataset
 * the project declares, so the choice reads as a choice — and a broken module keeps its row,
 * with the reason, instead of disappearing.
 */
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
      <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Database className="h-3.5 w-3.5" /> Dataset
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
        <div role="radiogroup" aria-label="Dataset drawn on the canvas" className="px-1">
          <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
            {datasets.length === 1
              ? 'The demo facts the canvas draws.'
              : 'Pick the demo facts the canvas draws.'}
          </p>
          {datasets.map((entry) =>
            entry.status === 'ready' ? (
              <button
                key={entry.path}
                type="button"
                role="radio"
                data-dataset-id={entry.id}
                aria-checked={entry.id === selectedId}
                onClick={() => onSelect(entry.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent',
                  entry.id === selectedId && 'bg-accent',
                )}
                title={entry.path}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center',
                    entry.id === selectedId ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {entry.id === selectedId ? (
                    <CircleDot className="h-3.5 w-3.5" />
                  ) : (
                    <Circle className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {datasetLabel(entry)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {entry.nodes.length} · {entry.edges.length}
                    </span>
                  </span>
                  {entry.description && (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                      {entry.description}
                    </span>
                  )}
                  {!entry.schemaMatch && (
                    <span className="mt-0.5 block text-[11px] text-warning">stale schema</span>
                  )}
                </span>
              </button>
            ) : (
              <div
                key={entry.path}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left"
                title={entry.error.message}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-warning">
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
          )}
          <p className="px-2 pt-1 text-[10px] text-muted-foreground">nodes · edges</p>
        </div>
      )}
    </div>
  )
}
