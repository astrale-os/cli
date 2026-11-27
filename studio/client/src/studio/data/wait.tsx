/**
 * The wait before a dataset is drawn, said as what it is: the dataset opened, what is being read
 * for it, and, past a second, how long the open has taken, on one clock from the moment it was
 * asked for — through the level's code, the datasets and the Schema alike.
 */

import { Loader2 } from 'lucide-react'

import { elapsedWords, useElapsed } from '@/lib/elapsed'

export function DataWait({
  since,
  dataset,
  reading,
}: {
  /** when the dataset was asked for, in epoch milliseconds */
  since: number
  /** the dataset, as the crumb names it once its Domain's datasets are read */
  dataset: string
  /** what is being read for it, as "Reading the Schema of crm.studio-demo.astrale.ai" */
  reading: string
}) {
  const elapsed = elapsedWords(useElapsed(Number.POSITIVE_INFINITY, since))
  return (
    <div
      role="status"
      aria-live="polite"
      data-data-wait=""
      className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center"
    >
      <p className="text-[13px] font-medium text-foreground">Opening {dataset}</p>
      <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>
          {reading}…
          {elapsed && (
            <span className="ml-1.5 tabular-nums" data-reading-elapsed="">
              {elapsed}
            </span>
          )}
        </span>
      </p>
    </div>
  )
}
