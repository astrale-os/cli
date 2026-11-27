/**
 * The address (`address.ts`) bound to the Studio's stores and the browser's history.
 *
 * - Arrival: on the first paint, and on Back or Forward, the URL's place is put into the stores
 *   in place of the Workspace's own UI state. A bare `/` leaves that state as it is.
 * - Checks: what the place names inside a Domain (a Schema selection, a dataset, a Scenario and
 *   its step, a Node) is checked once the Domain's reads answer. What is gone lands on the
 *   nearest thing that is, and is said once, in a notice, when the level it concerns is on
 *   screen (`notices.ts`).
 * - Writing: every change of place pushes a history entry; a change within a place (a
 *   selection, an identity, a step) replaces the current one. Hover, pan, zoom and drags are in
 *   no store the address reads, so they never reach it.
 */

import type { StudioDataset } from '@shared/contracts/schema'
import type { DomainSummary } from '@shared/contracts/workspace'

import { publicationOf } from '@shared/contracts/versions'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { create } from 'zustand'

import { datasetLabel, findDataset } from '@/studio/data/model'
import { datasetScope, useDataView } from '@/studio/data/store'
import { scenariosQueryOptions } from '@/studio/data/use-scenarios'
import { useWorkspaceView } from '@/studio/workspace/selection'

import {
  type Address,
  addressOf,
  type DataSelection,
  dataView,
  formatAddress,
  isNewPlace,
  type ParsedAddress,
  parseAddress,
  resolveDataView,
} from './address'
import { qk } from './api'
import { bundleQueryOptions } from './domain-queries'
import { useDatasets } from './hooks'
import { type Place, sayOnScreen } from './notices'
import { queryClient } from './query'
import { shownDomainId, useUI } from './store'

/** What an arrival named inside a Domain, until the Domain's reads can say whether it is there. */
interface Checks {
  schema?: { domainId: string; ref: string }
  data?: {
    domainId: string
    /** the dataset named; none opens the Domain's Datasets page, and there is nothing to check */
    path: string
    /** the Data level's view */
    view: DataSelection
  }
}

const useChecks = create<Checks>(() => ({}))

/**
 * Says once what an address named that is not there, when `place` — where the reader lands for
 * it — is on screen: the same words are one notice.
 */
export function reportMissing(message: string, place?: Place): void {
  sayOnScreen(message, place)
}

/** The place an address lands on. */
const placeOf = (address: Address): Place =>
  address.level === 'workspace'
    ? { level: 'workspace' }
    : { level: address.level, domainId: address.domainId }

/** The Domains an address may name: the Workspace's, and any Publication. */
const readable = (domains: readonly DomainSummary[], domainId: string) =>
  publicationOf(domainId) !== undefined || domains.some((domain) => domain.id === domainId)

const nameOf = (domains: readonly DomainSummary[], domainId: string) => {
  const publication = publicationOf(domainId)
  if (publication) return `${publication.origin} ${publication.version}`
  return domains.find((domain) => domain.id === domainId)?.origin ?? domainId
}

/** Puts a place into the stores, and keeps what of it the Domain's reads must still confirm. */
function arrive(parsed: ParsedAddress, domains: readonly DomainSummary[]): void {
  const address = parsed.address
  // said where the reader lands: the place named, or, with none, wherever the Studio opens
  const landing =
    address && (address.level === 'workspace' || readable(domains, address.domainId))
      ? placeOf(address)
      : address
        ? ({ level: 'workspace' } as const)
        : undefined
  if (parsed.unknown)
    reportMissing(`The address names ${parsed.unknown}, which the Studio does not know.`, landing)
  if (parsed.retired)
    reportMissing(
      `The address names ${parsed.retired}, which the Studio no longer has: the Data level reads the same dataset.`,
      landing,
    )
  useChecks.setState({ schema: undefined, data: undefined }, true)
  if (!address) return
  const ui = useUI.getState()
  if (address.level === 'workspace') {
    ui.openWorkspace()
    useWorkspaceView.getState().arrive(address.map)
    return
  }
  const { domainId } = address
  if (!readable(domains, domainId)) {
    reportMissing(`This Workspace holds no Domain ${domainId}: the Workspace is open instead.`, {
      level: 'workspace',
    })
    ui.openWorkspace()
    useWorkspaceView.getState().arrive(undefined)
    return
  }
  ui.openDomain(domainId)
  if (address.level === 'domain') {
    if (address.lens) ui.setLens(address.lens)
    if (address.select) {
      useUI.getState().selectClass(address.select, domainId)
      useChecks.setState({ schema: { domainId, ref: address.select } })
    } else useUI.getState().clearSelection()
    return
  }
  if (address.lens) ui.setLens(address.lens)
  useUI.getState().openDataLevel(address.dataset ?? null)
  if (address.dataset)
    useChecks.setState({ data: { domainId, path: address.dataset, view: address.view } })
}

// ─── The history entry ────────────────────────────────────────────────────────

/** The writer's own state: one Studio per page, so one entry it keeps up to date. */
const history = {
  domains: [] as readonly DomainSummary[],
  /** the address the current entry was last written with */
  last: undefined as Address | undefined,
  /** whether store changes reach the URL: not before arrival, nor while one is being put */
  writing: false,
}

/** The ready dataset of `domainId` at `path`, as the Studio has read it. */
function datasetAt(domainId: string, path: string): StudioDataset | undefined {
  const entries = queryClient.getQueryData<{ datasets: Parameters<typeof findDataset>[0] }>(
    qk.datasets(domainId),
  )?.datasets
  const found = entries ? findDataset(entries, path) : undefined
  return found?.status === 'ready' ? found.dataset : undefined
}

/** The address of what the stores show now. */
function addressNow(): Address | undefined {
  const ui = useUI.getState()
  const domainId = shownDomainId(ui, history.domains)
  let view: DataSelection | undefined
  if (ui.level === 'data' && domainId && ui.dataset) {
    const pending = useChecks.getState().data
    if (pending && pending.domainId === domainId && pending.path === ui.dataset) view = pending.view
    else {
      const dataset = datasetAt(domainId, ui.dataset)
      const held = dataset
        ? useDataView.getState().views[datasetScope(domainId, dataset.id)]
        : undefined
      if (held) view = held
    }
  }
  return addressOf({
    level: ui.level,
    ...(domainId ? { domainId } : {}),
    lens: ui.lens,
    dataset: ui.dataset,
    ...(ui.selectedClass ? { selected: ui.selectedClass } : {}),
    ...(ui.selectionDomainId ? { selectionDomainId: ui.selectionDomainId } : {}),
    ...(useWorkspaceView.getState().selected ? { map: useWorkspaceView.getState().selected } : {}),
    ...(view ? { view } : {}),
  })
}

/** Writes the current entry: a new one for a new place, unless `replace` says it is the same. */
function write(replace = false): void {
  if (!history.writing) return
  const next = addressNow()
  if (!next) return
  const url = formatAddress(next)
  const push = !replace && history.last !== undefined && isNewPlace(history.last, next)
  history.last = next
  if (url === `${location.pathname}${location.search}`) return
  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

/**
 * Store changes that put the reader where they already are — an arrival, a correction of what
 * it named — replace the entry, once they are all made.
 */
function inPlace(change: () => void): void {
  const was = history.writing
  history.writing = false
  try {
    change()
  } finally {
    history.writing = was
  }
  write(true)
}

/**
 * Arrives at the URL's place once the Workspace's UI state is read, then keeps the URL on what
 * the Studio shows. Answers whether the arrival is made: nothing should draw before it.
 */
export function useAddress({
  ready,
  domains,
}: {
  ready: boolean
  domains: readonly DomainSummary[] | undefined
}): boolean {
  const [arrived, setArrived] = useState(false)

  // A Domain that leaves the Workspace moves what is shown, in place: no entry to go back to.
  useEffect(() => {
    if (domains) history.domains = domains
    if (arrived) write(true)
  }, [arrived, domains])

  // The arrival is made once per page: Strict Mode runs this effect twice.
  useEffect(() => {
    if (!ready || !domains || arrived || history.writing) return
    arrive(parseAddress(location.pathname, location.search), domains)
    history.writing = true
    history.last = undefined
    write(true)
    setArrived(true)
  }, [arrived, domains, ready])

  useEffect(() => {
    if (!arrived) return
    const onChange = () => write()
    const stops = [
      useUI.subscribe(onChange),
      useWorkspaceView.subscribe(onChange),
      useDataView.subscribe(onChange),
      useChecks.subscribe(onChange),
    ]
    const onPop = () =>
      inPlace(() => arrive(parseAddress(location.pathname, location.search), history.domains))
    window.addEventListener('popstate', onPop)
    return () => {
      for (const stop of stops) stop()
      window.removeEventListener('popstate', onPop)
    }
  }, [arrived])

  useSchemaCheck(domains ?? [])
  useDataCheck(domains ?? [])
  return arrived
}

/** A Schema selection the address named, once the Domain's bundle is read. */
function useSchemaCheck(domains: readonly DomainSummary[]): void {
  const check = useChecks((state) => state.schema)
  const bundle = useQuery({ ...bundleQueryOptions(check?.domainId ?? ''), enabled: !!check })
  useEffect(() => {
    if (!check) return
    // a Domain that cannot be read says so itself; there is nothing to check its selection on
    if (bundle.isError) return useChecks.setState({ schema: undefined })
    const read = bundle.data
    if (!read) return
    let live = true
    void import('./address-targets').then(({ resolveSchemaRef }) => {
      if (!live || useChecks.getState().schema !== check) return
      const answer = resolveSchemaRef(read, check.ref)
      inPlace(() => {
        useChecks.setState({ schema: undefined })
        if (answer.found) return
        const ui = useUI.getState()
        // the reader has moved on: what they chose stands
        if (ui.selectedClass === check.ref && ui.selectionDomainId === check.domainId) {
          if (answer.nearest) ui.selectClass(answer.nearest, check.domainId)
          else ui.clearSelection()
        }
        reportMissing(
          `${nameOf(domains, check.domainId)} has no ${check.ref}: ${answer.nearest ? `${answer.nearest} is selected instead` : 'nothing is selected'}.`,
          { level: 'domain', domainId: check.domainId },
        )
      })
    })
    return () => {
      live = false
    }
  }, [bundle.data, bundle.isError, check, domains])
}

/** A dataset the address named, and the Data level's view of it, once the datasets are read. */
function useDataCheck(domains: readonly DomainSummary[]): void {
  const check = useChecks((state) => state.data)
  const datasets = useDatasets(check?.domainId, { enabled: !!check })
  const scenarios = useQuery({
    ...scenariosQueryOptions(check?.domainId ?? ''),
    enabled: !!check?.view.scenario,
  })
  useEffect(() => {
    if (!check) return
    // datasets that cannot be extracted say so where they are read
    if (datasets.isError) return useChecks.setState({ data: undefined })
    if (!datasets.data) return
    const found = findDataset(datasets.data.datasets, check.path)
    if (found.status !== 'ready')
      return inPlace(() => {
        useChecks.setState({ data: undefined })
        if (found.status !== 'missing') return
        const ui = useUI.getState()
        const still = ui.dataset === check.path && shownDomainId(ui, domains) === check.domainId
        if (still) ui.openDataLevel(null)
        reportMissing(
          `${nameOf(domains, check.domainId)} declares no dataset ${check.path}: its datasets are listed instead.`,
          { level: 'data', domainId: check.domainId },
        )
      })
    if (check.view.scenario && scenarios.isPending) return
    const listed = scenarios.data?.scenarios.filter((one) => one.dataset === check.path)
    const { view, missing } = resolveDataView(found.dataset, check.view, listed)
    inPlace(() => {
      useDataView.getState().restore(datasetScope(check.domainId, found.dataset.id), dataView(view))
      useChecks.setState({ data: undefined })
    })
    if (missing.length > 0)
      reportMissing(
        `The address names ${missing.join(' and ')}, which ${datasetLabel(found.dataset)} does not hold: the dataset is open without ${missing.length === 1 ? 'it' : 'them'}.`,
        { level: 'data', domainId: check.domainId },
      )
  }, [check, datasets.data, datasets.isError, domains, scenarios.data, scenarios.isPending])
}
