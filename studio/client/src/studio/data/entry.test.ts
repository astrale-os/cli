import type { StudioDataset, StudioDatasetFailure, StudioDatasets } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'

import { qk } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { useUI } from '@/lib/store'

import { datasetToOpen, openChosenDataset, switchToData } from './entry'

const ready = (name: string): StudioDataset => ({
  status: 'ready',
  path: `./tests/datasets/${name}.ts`,
  id: name,
  origin: 'desk.example.dev',
  revision: 'r1',
  schemaMatch: true,
  references: {},
  nodes: [],
  edges: [],
  variables: {},
})
const failed = (name: string): StudioDatasetFailure => ({
  status: 'failed',
  path: `./tests/datasets/${name}.ts`,
  error: { message: 'Dataset module not found' },
})

const TRIAGE = ready('triage')
const OWNERS = ready('owners')
const BROKEN = failed('broken')

test('Data opens the dataset last read on the Domain while the Domain still declares it', () => {
  expect(datasetToOpen([TRIAGE, OWNERS], OWNERS.path)).toBe(OWNERS.path)
  // unreadable now, it still opens: its level says why
  expect(datasetToOpen([TRIAGE, BROKEN], BROKEN.path)).toBe(BROKEN.path)
  // gone from the Domain, it is not opened
  expect(datasetToOpen([TRIAGE], OWNERS.path)).toBe(TRIAGE.path)
})

test('else the one dataset it can read, else its Datasets page', () => {
  expect(datasetToOpen([TRIAGE], undefined)).toBe(TRIAGE.path)
  expect(datasetToOpen([BROKEN, TRIAGE], undefined)).toBe(TRIAGE.path)
  expect(datasetToOpen([TRIAGE, OWNERS], undefined)).toBeNull()
  expect(datasetToOpen([BROKEN], undefined)).toBeNull()
  expect(datasetToOpen([], undefined)).toBeNull()
  expect(datasetToOpen([TRIAGE, OWNERS], './tests/datasets/gone.ts')).toBeNull()
})

const datasetsOf = (domainId: string, datasets: StudioDatasets['datasets']) =>
  queryClient.setQueryData<StudioDatasets>(qk.datasets(domainId), {
    domainId,
    datasets,
    extractedAt: '',
  })

test('switching to Data opens the chosen dataset at once when the datasets are read', () => {
  datasetsOf('desk', [TRIAGE, OWNERS])
  useUI.setState({ readerDomainId: 'desk', level: 'domain', lens: 'rules', dataset: null })
  useUI.getState().rememberDataset('desk', OWNERS.path)
  switchToData('desk')
  expect(useUI.getState()).toMatchObject({
    level: 'data',
    lens: 'rules',
    dataset: OWNERS.path,
    choosingDataset: false,
  })

  // already reading Data, the switch keeps the dataset open
  useUI.getState().openDataLevel(TRIAGE.path)
  switchToData('desk')
  expect(useUI.getState().dataset).toBe(TRIAGE.path)
})

test('switching to Data before the datasets are read waits on them, then chooses', () => {
  useUI.setState({ readerDomainId: 'unread', level: 'domain', lens: 'views', dataset: null })
  switchToData('unread')
  expect(useUI.getState()).toMatchObject({
    level: 'data',
    lens: 'structure',
    dataset: null,
    choosingDataset: true,
  })

  openChosenDataset('unread', [OWNERS])
  expect(useUI.getState()).toMatchObject({ dataset: OWNERS.path, choosingDataset: false })
})

test('datasets that could not be extracted open the Datasets page, which says why', () => {
  useUI.setState({ readerDomainId: 'lost', level: 'domain', dataset: null })
  useUI.getState().chooseDataset()
  openChosenDataset('lost', undefined)
  expect(useUI.getState()).toMatchObject({ level: 'data', dataset: null, choosingDataset: false })
})

test('the dataset last read is kept per Domain, the one read longest ago giving way first', () => {
  const ui = () => useUI.getState()
  for (let index = 0; index < 70; index++) ui().rememberDataset(`domain-${index}`, TRIAGE.path)
  expect(Object.keys(ui().lastDatasets)).toHaveLength(64)
  expect(ui().lastDatasets['domain-0']).toBeUndefined()
  expect(ui().lastDatasets['domain-69']).toBe(TRIAGE.path)

  // read again, a Domain is the most recent: it outlasts the others
  ui().rememberDataset('domain-6', OWNERS.path)
  for (let index = 70; index < 133; index++) ui().rememberDataset(`domain-${index}`, TRIAGE.path)
  expect(ui().lastDatasets['domain-6']).toBe(OWNERS.path)
  expect(ui().lastDatasets['domain-7']).toBeUndefined()
})
