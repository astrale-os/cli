/**
 * The Schema level's selection carried to the Data level: a Policy, to read what it admits on a
 * dataset of its Domain. The selection is written into that dataset's own view before the level
 * opens it, as an address would: nothing waits for the next dataset to take it, so a carry that
 * cannot land leaves nothing behind.
 */

import { toast } from 'sonner'

import { datasetsQueryOptions } from '@/lib/hooks'
import { queryClient } from '@/lib/query'
import { useUI } from '@/lib/store'

import { loadDataLevel } from './load'
import { findDataset, isReadyDataset } from './model'
import { datasetScope, useDataView } from './store'

/**
 * Opens `selected` (`name` in words) on the dataset of `domainId` last read, else its first ready
 * one, through the lens shown. A Domain with no ready dataset keeps the reader where they are,
 * and says so.
 */
export async function carryToDataset(
  domainId: string,
  selected: string,
  name: string,
): Promise<void> {
  // the level's code loads while the datasets are read
  void loadDataLevel()
  let entries
  try {
    entries = (await queryClient.ensureQueryData(datasetsQueryOptions(domainId))).datasets
  } catch (error) {
    toast(`${name} cannot be read on a dataset`, {
      description: `The datasets could not be extracted: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }
  const ui = useUI.getState()
  const last =
    ui.readerDomainId === domainId && ui.dataset !== null
      ? findDataset(entries, ui.dataset)
      : undefined
  const dataset = last?.status === 'ready' ? last.dataset : entries.find(isReadyDataset)
  if (!dataset) {
    toast(`${name} cannot be read on a dataset`, {
      description: 'This Domain has no dataset that could be read.',
    })
    return
  }
  // a Policy is no box on the map: nothing to bring into view, its pairs light where they are
  useDataView.getState().select(datasetScope(domainId, dataset.id), selected)
  useUI.getState().openDataLevel(dataset.path)
}
