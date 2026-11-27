/**
 * The address of a place in the Studio: the URL's path and query, so a reload, a link pasted in
 * another tab and Back/Forward land where the reader was. A place is a level, a Domain, a dataset
 * and a lens; within a place, the address also names the selection, and at the Data level the
 * Scenario and step open, the identity Rules reads as and the verdict lit.
 *
 * - `/workspace`, with the map's selection: `?domain=<id>`, `?origin=<origin>`, or
 *   `?domain=<id>&dependency=<alias>`.
 * - `/domain/<id>?lens=<lens>&select=<ref>`: a workspace Domain's Schema.
 * - `/domain/<id>/data?dataset=<path>&lens=<lens>&select=<scene id>&as=<identity>&verdict=<id>&scenario=<id>&step=<id>`.
 *   The retired `/domain/<id>/tests?dataset=<path>` lands here, on the same dataset under Rules,
 *   and says so once.
 * - `/publication/<origin>/<version>?lens=<lens>&select=<ref>`: one published version, read-only.
 *
 * Bare `/` names no place: the Workspace's own UI state decides. Nothing here reads a store or a
 * query; `use-address.ts` binds it to the Studio.
 */

import type { Scenario } from '@shared/contracts/scenarios'
import type { StudioDataset } from '@shared/contracts/schema'

import { ANYONE } from '@shared/contracts/scenarios'
import { publicationOf, publishedDomainId } from '@shared/contracts/versions'

import { LENS_KEYS, type LensKey } from '@/studio/lenses/keys'

/** What the Data level holds of one dataset, as an address names it. */
export interface DataSelection {
  /** the selected scene id: `core.node.<path>`, `core.edge.<i>`, a region… */
  selected?: string
  /** the identity Rules reads as: a Node's path; absent reads as anyone */
  identity?: string
  verdict?: string
  scenario?: string
  step?: string
}

export type Address =
  | {
      level: 'workspace'
      /** the map's selection: `domain:<id>`, `origin:<origin>` or `dependency:<id>:<alias>` */
      map?: string
    }
  | {
      level: 'domain'
      /** a workspace Domain's id, or a Publication's (`@registry:<origin>@<version>`) */
      domainId: string
      lens?: LensKey
      /** the selection on the canvas, as the Studio names it (`class.X`, `class.X#read`…) */
      select?: string
    }
  | {
      level: 'data'
      domainId: string
      dataset?: string
      lens?: LensKey
      view: DataSelection
    }

/** What a URL says: a place, the Workspace's own state (bare `/`), and what it named that no Studio place is. */
export interface ParsedAddress {
  address?: Address
  /** the part of the URL that names nothing, in words: "the path /x", "the lens “x”" */
  unknown?: string
  /** a place the Studio retired, in words, when the address lands where it is read now */
  retired?: string
}

/** What the retired Tests place said: one dataset, the Domain's Policies proven on it. */
const RETIRED_TESTS = 'Tests'

const isLens = (value: string | null): value is LensKey =>
  value !== null && (LENS_KEYS as readonly string[]).includes(value)

/** A path segment, `@` kept as written: `/domain/@kernel` reads better than `%40kernel`. */
const segment = (value: string) => encodeURIComponent(value).replace(/%40/g, '@')

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/** The path a Domain is read at: a workspace Domain's, or a Publication's. */
function domainPath(domainId: string): string {
  const publication = publicationOf(domainId)
  return publication
    ? `/publication/${segment(publication.origin)}/${segment(publication.version)}`
    : `/domain/${segment(domainId)}`
}

function query(entries: Array<[string, string | undefined]>): string {
  const params = new URLSearchParams()
  for (const [name, value] of entries)
    if (value !== undefined && value !== '') params.set(name, value)
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** The URL path and query of a place. Parameters are written in one order, so equal places format equal. */
export function formatAddress(address: Address): string {
  if (address.level === 'workspace') {
    const target = mapParams(address.map)
    return `/workspace${query(target)}`
  }
  const base = domainPath(address.domainId)
  if (address.level === 'data') {
    const { view } = address
    return `${base}/data${query([
      ['dataset', address.dataset],
      ['lens', address.lens],
      ['select', view.selected],
      ['as', view.identity === ANYONE ? undefined : view.identity],
      ['verdict', view.verdict],
      ['scenario', view.scenario],
      ['step', view.step],
    ])}`
  }
  return `${base}${query([
    ['lens', address.lens],
    ['select', address.select],
  ])}`
}

function mapParams(map: string | undefined): Array<[string, string | undefined]> {
  if (!map) return []
  if (map.startsWith('domain:')) return [['domain', map.slice('domain:'.length)]]
  if (map.startsWith('origin:')) return [['origin', map.slice('origin:'.length)]]
  const link = /^dependency:([^:]+):(.+)$/.exec(map)
  return link
    ? [
        ['domain', link[1]],
        ['dependency', link[2]],
      ]
    : []
}

function mapOf(params: URLSearchParams): string | undefined {
  const domain = params.get('domain')
  const dependency = params.get('dependency')
  const origin = params.get('origin')
  if (domain && dependency) return `dependency:${domain}:${dependency}`
  if (domain) return `domain:${domain}`
  if (origin) return `origin:${origin}`
  return undefined
}

const optional = (params: URLSearchParams, name: string) => params.get(name) || undefined

/** Reads a URL's path and query. A part it cannot read is named in `unknown`; the rest still reads. */
export function parseAddress(pathname: string, search: string): ParsedAddress {
  const params = new URLSearchParams(search)
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return {}
  if (parts[0] === 'workspace' && parts.length === 1) {
    const map = mapOf(params)
    return { address: { level: 'workspace', ...(map ? { map } : {}) } }
  }

  let domainId: string | undefined
  let rest: string[]
  if (parts[0] === 'domain' && parts.length >= 2) {
    domainId = decodeSegment(parts[1]!)
    rest = parts.slice(2)
  } else if (parts[0] === 'publication' && parts.length >= 3) {
    const origin = decodeSegment(parts[1]!)
    const version = decodeSegment(parts[2]!)
    const id = origin && version ? publishedDomainId(origin, version) : undefined
    domainId = id && publicationOf(id) ? id : undefined
    rest = parts.slice(3)
    if (!domainId) return { unknown: `the Publication ${parts.slice(1, 3).join(' ')}` }
  } else return { unknown: `the path ${pathname}` }
  if (!domainId) return { unknown: `the path ${pathname}` }
  if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== 'tests' && rest[0] !== 'data'))
    return { unknown: `the path ${pathname}` }

  const lens = params.get('lens')
  const unknownLens = lens !== null && !isLens(lens) ? `the lens “${lens}”` : undefined
  const known = isLens(lens) ? { lens } : {}
  const dataset = optional(params, 'dataset')
  let address: Address
  // Tests read a dataset's Policies: the Data level reads the same dataset, its Rules lens them
  if (rest[0] === 'tests')
    return {
      address: {
        level: 'data',
        domainId,
        ...(dataset ? { dataset } : {}),
        lens: 'rules',
        view: {},
      },
      retired: RETIRED_TESTS,
    }
  if (rest[0] === 'data') {
    const view: DataSelection = {}
    for (const [field, name] of [
      ['selected', 'select'],
      ['identity', 'as'],
      ['verdict', 'verdict'],
      ['scenario', 'scenario'],
      ['step', 'step'],
    ] as const) {
      const value = optional(params, name)
      if (value) view[field] = value
    }
    address = {
      level: 'data',
      domainId,
      ...(dataset ? { dataset } : {}),
      ...known,
      view: dataView(view),
    }
  } else {
    const select = optional(params, 'select')
    address = { level: 'domain', domainId, ...known, ...(select ? { select } : {}) }
  }
  return { address, ...(unknownLens ? { unknown: unknownLens } : {}) }
}

/**
 * The place an address names: its level, Domain, dataset and lens — not what is selected in it.
 * Back and Forward walk places; a selection within one replaces its entry.
 */
export interface Place {
  level: Address['level']
  domainId?: string
  dataset?: string
  lens?: LensKey
}

export function placeOf(address: Address): Place {
  if (address.level === 'workspace') return { level: 'workspace' }
  if (address.level === 'data')
    return {
      level: 'data',
      domainId: address.domainId,
      ...(address.dataset ? { dataset: address.dataset } : {}),
      ...(address.lens ? { lens: address.lens } : {}),
    }
  return {
    level: 'domain',
    domainId: address.domainId,
    ...(address.lens ? { lens: address.lens } : {}),
  }
}

/**
 * Whether `next` is `last` said more fully: every part `last` names, `next` names alike. Opening
 * a dataset level on no dataset and then on the first ready one, or an address arriving without
 * a lens and written with the one shown, refines a place rather than leaving it.
 */
export function refines(last: Place, next: Place): boolean {
  return (Object.keys(last) as Array<keyof Place>).every((key) => last[key] === next[key])
}

/** Whether going from `last` to `next` is a new place, one Back returns from. */
export function isNewPlace(last: Address, next: Address): boolean {
  return !refines(placeOf(last), placeOf(next))
}

/** What the Studio shows, as its stores hold it: what an address is made of. */
export interface Shown {
  level: Address['level']
  /** the Domain the levels read; none in a Workspace that holds no Domain */
  domainId?: string
  lens: LensKey
  /** the dataset the Data level reads, by module path; null reads the first ready one */
  dataset: string | null
  /** the Schema selection, and the Domain it belongs to */
  selected?: string
  selectionDomainId?: string
  /** the Workspace map's selection */
  map?: string
  /** the open dataset's view */
  view?: DataSelection
}

/** The address of what is shown; none for a Domain level with no Domain to read. */
export function addressOf(shown: Shown): Address | undefined {
  if (shown.level === 'workspace')
    return { level: 'workspace', ...(shown.map ? { map: shown.map } : {}) }
  const { domainId } = shown
  if (!domainId) return undefined
  const dataset = shown.dataset ?? undefined
  if (shown.level === 'data')
    return {
      level: 'data',
      domainId,
      ...(dataset ? { dataset } : {}),
      lens: shown.lens,
      view: dataView(shown.view ?? {}),
    }
  const select = shown.selectionDomainId === domainId ? shown.selected : undefined
  return { level: 'domain', domainId, lens: shown.lens, ...(select ? { select } : {}) }
}

/** A dataset's view as an address names it: only what is set, anyone left unsaid. */
export function dataView(view: DataSelection): DataSelection {
  const named: DataSelection = {}
  if (view.selected) named.selected = view.selected
  if (view.identity && view.identity !== ANYONE) named.identity = view.identity
  if (view.verdict) named.verdict = view.verdict
  if (view.scenario) {
    named.scenario = view.scenario
    if (view.step) named.step = view.step
  }
  return named
}

// ─── What an address names that is gone ───────────────────────────────────────

/** A Data level selection as `dataset` and its Scenarios still hold it, and what of it is gone. */
export function resolveDataView(
  dataset: StudioDataset,
  view: DataSelection,
  /** the dataset's Scenarios; absent while they are read, when the Scenario is not checked */
  scenarios: readonly Scenario[] | undefined,
): { view: DataSelection; missing: string[] } {
  const missing: string[] = []
  const nodes = new Set(dataset.nodes.map((node) => node.path))
  const resolved: DataSelection = {}
  if (view.selected) {
    const path = view.selected.startsWith('core.node.')
      ? view.selected.slice('core.node.'.length)
      : undefined
    const edge = /^core\.edge\.(\d+)$/.exec(view.selected)
    const gone =
      (path !== undefined && !nodes.has(path)) ||
      (edge !== null && Number(edge[1]) >= dataset.edges.length)
    if (gone) missing.push(path !== undefined ? `the Node ${path}` : `the Edge ${view.selected}`)
    else resolved.selected = view.selected
  }
  if (view.identity && view.identity !== ANYONE) {
    if (nodes.has(view.identity)) resolved.identity = view.identity
    else missing.push(`the identity ${view.identity}`)
  }
  if (view.verdict) resolved.verdict = view.verdict
  if (view.scenario) {
    const scenario = scenarios?.find((one) => one.id === view.scenario)
    if (scenarios && !scenario) missing.push(`the Scenario ${view.scenario}`)
    else {
      resolved.scenario = view.scenario
      if (view.step) {
        if (scenario && !scenario.steps.some((step) => step.id === view.step))
          missing.push(`the step ${view.step} of ${scenario.name}`)
        else resolved.step = view.step
      }
    }
  }
  return { view: resolved, missing }
}
