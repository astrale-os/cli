/**
 * Which dataset the Data level opens on when the reader switches to Data: the one last read on
 * the Domain, while the Domain still declares it; else the Domain's one readable dataset; else
 * none, and the Domain's Datasets page opens, where one is picked. An address names its dataset
 * itself, or names the Datasets page: arriving at one never chooses.
 */

import type { StudioDataset, StudioDatasetFailure, StudioDatasets } from '@shared/contracts/schema'

import { qk } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { useUI } from '@/lib/store'

import { findDataset, isReadyDataset } from './model'

/** The module path of the dataset to open among a Domain's `entries`; null opens its Datasets page. */
export function datasetToOpen(
  entries: readonly (StudioDataset | StudioDatasetFailure)[],
  lastRead: string | undefined,
): string | null {
  // the reader's own choice stands, even unreadable: its level says why
  if (lastRead !== undefined && findDataset(entries, lastRead).status !== 'missing') return lastRead
  const readable = entries.filter(isReadyDataset)
  return readable.length === 1 ? readable[0]!.path : null
}

/**
 * Opens the Data level of `domainId` on the dataset `datasetToOpen` chooses among `entries`, its
 * Datasets page when they could not be read.
 */
export function openChosenDataset(
  domainId: string,
  entries: readonly (StudioDataset | StudioDatasetFailure)[] | undefined,
): void {
  const ui = useUI.getState()
  ui.openDataLevel(entries ? datasetToOpen(entries, ui.lastDatasets[domainId]) : null)
}

/**
 * Switches the shown Domain, `domainId`, to Data. Its datasets read, the dataset opens at once;
 * not read yet, the level waits on them and chooses once they answer (`choosingDataset`).
 * Already at the Data level, nothing changes.
 */
export function switchToData(domainId: string): void {
  if (useUI.getState().level === 'data') return
  const answer = queryClient.getQueryData<StudioDatasets>(qk.datasets(domainId))
  if (answer) openChosenDataset(domainId, answer.datasets)
  else useUI.getState().chooseDataset()
}
