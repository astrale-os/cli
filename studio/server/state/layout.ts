/**
 * layout.ts — a canvas's persisted arrangement: a Domain's, the Kernel's or the Workspace map's.
 * Each Studio lens keeps its own under `lenses`, positions keyed by box id (e.g. `class.Monitor`),
 * so they survive schema changes: a removed box's position is harmless, a new box is laid out
 * automatically. Its shut modules are under `collapsed`, the folds opened by hand under `opened`,
 * how it draws each other Domain under `domains`: what is open and which Domains are drawn is what
 * the reader reads, so forgetting where boxes stand keeps all three. Stamped
 * with the render fingerprint for reference. Persisted via the allow-listed store (layout.json).
 *
 * The file is read whole or not at all (state-file.ts), within `LAYOUT_LIMITS`. A key this
 * Studio does not know is kept through every rewrite and every reset — among them `positions`,
 * the arrangement an earlier Studio made on one canvas for every Class, which that Studio
 * still reads.
 */
import type { DomainShare, LayoutState, NodePosition } from '../../shared/contracts/workspace'

import { DOMAIN_SHARES, LAYOUT_LIMITS } from '../../shared/contracts/workspace'
import { asJsonRecord, refused, type Decoded } from '../json'
import { changeStateFile, forgetStateFile, stateOf, type Shape, type StateFile } from './state-file'

/** A layout refused: what it carries does not hold, or holds more than `LAYOUT_LIMITS`. */
export type LayoutRefusal = { readonly problem: string; readonly tooLarge?: true }
type LayoutDecoded<T> = { readonly value: T } | LayoutRefusal

const tooLarge = (problem: string): LayoutRefusal => ({ problem, tooLarge: true })

const isCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LAYOUT_LIMITS.coordinate
const isSize = (value: unknown): value is number => isCoordinate(value) && value >= 0

/** A box's, a module's or a fold's id: a non-empty string within `LAYOUT_LIMITS.id`. */
function idOf(value: unknown, at: string): LayoutDecoded<string> {
  if (typeof value !== 'string' || value.length === 0) return refused(`${at} names no id`)
  if (value.length > LAYOUT_LIMITS.id)
    return tooLarge(`${at} has an id longer than ${LAYOUT_LIMITS.id} characters`)
  return { value }
}

function positionOf(value: unknown, at: string): Decoded<NodePosition> {
  const record = asJsonRecord(value)
  if (!record) return refused(`${at} is not a position`)
  const { x, y, w, h } = record
  if (!isCoordinate(x) || !isCoordinate(y))
    return refused(`${at} stands at no x and y within ${LAYOUT_LIMITS.coordinate} of 0`)
  if ((w !== undefined && !isSize(w)) || (h !== undefined && !isSize(h)))
    return refused(`${at} has a size that is not a number from 0 to ${LAYOUT_LIMITS.coordinate}`)
  return {
    value: { x, y, ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) },
  }
}

/** Positions by box id, as a write carries them or a lens keeps them. */
export function positionsOf(
  value: unknown,
  at = 'the positions',
): LayoutDecoded<Record<string, NodePosition>> {
  const record = asJsonRecord(value)
  if (!record) return refused(`${at} are not a record by box id`)
  const entries = Object.entries(record)
  if (entries.length > LAYOUT_LIMITS.positions)
    return tooLarge(`${at} place more than ${LAYOUT_LIMITS.positions} boxes`)
  const positions: Record<string, NodePosition> = {}
  for (const [id, candidate] of entries) {
    const key = idOf(id, `a box of ${at}`)
    if ('problem' in key) return key
    const position = positionOf(candidate, `the box ${id}`)
    if ('problem' in position) return position
    positions[id] = position.value
  }
  return { value: positions }
}

/** A lens id as layouts key it: a lower-case word, dashes allowed. */
const LENS_ID = /^[a-z][a-z0-9-]{0,31}$/

export function isLensId(value: unknown): value is string {
  return typeof value === 'string' && LENS_ID.test(value)
}

/** Ids as a lens keeps a set of them (shut modules, open folds): distinct, sorted. */
export function idsOf(value: unknown, at = 'the ids'): LayoutDecoded<string[]> {
  if (!Array.isArray(value)) return refused(`${at} are not a list`)
  if (value.length > LAYOUT_LIMITS.ids) return tooLarge(`${at} name more than ${LAYOUT_LIMITS.ids}`)
  const ids = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    const id = idOf(candidate, `item ${index + 1} of ${at}`)
    if ('problem' in id) return id
    ids.add(id.value)
  }
  return { value: [...ids].sort() }
}

export function isDomainShare(value: unknown): value is DomainShare {
  return DOMAIN_SHARES.includes(value as DomainShare)
}

/** How a lens draws the other Domains, by origin. */
export function sharesOf(
  value: unknown,
  at = 'the Domains',
): LayoutDecoded<Record<string, DomainShare>> {
  const record = asJsonRecord(value)
  if (!record) return refused(`${at} are not a record by Domain origin`)
  const entries = Object.entries(record)
  if (entries.length > LAYOUT_LIMITS.domains)
    return tooLarge(`${at} name more than ${LAYOUT_LIMITS.domains} Domains`)
  const shares: Record<string, DomainShare> = {}
  for (const [origin, share] of entries) {
    const key = idOf(origin, `a Domain of ${at}`)
    if ('problem' in key) return key
    if (!isDomainShare(share))
      return refused(`${at} draw ${origin} as ${JSON.stringify(share)}, not hidden or whole`)
    shares[origin] = share
  }
  return { value: shares }
}

/** A record by lens id, each lens's value decoded by `decode`. */
function byLensOf<T>(
  value: unknown,
  what: string,
  decode: (value: unknown, at: string) => LayoutDecoded<T>,
): LayoutDecoded<Record<string, T> | undefined> {
  if (value === undefined) return { value: undefined }
  const record = asJsonRecord(value)
  if (!record) return refused(`its ${what} are not a record by lens`)
  const entries = Object.entries(record)
  if (entries.length > LAYOUT_LIMITS.lenses)
    return tooLarge(`its ${what} name more than ${LAYOUT_LIMITS.lenses} lenses`)
  const byLens: Record<string, T> = {}
  for (const [lens, candidate] of entries) {
    if (!isLensId(lens)) return refused(`its ${what} name ${JSON.stringify(lens)}, not a lens`)
    const decoded = decode(candidate, `the ${what} of the lens ${lens}`)
    if ('problem' in decoded) return decoded
    byLens[lens] = decoded.value
  }
  return { value: byLens }
}

function layoutOf(value: unknown): Decoded<LayoutState> {
  const record = asJsonRecord(value)
  if (!record) return refused('it holds no object')
  const { renderFingerprint } = record
  if (renderFingerprint !== undefined && typeof renderFingerprint !== 'string')
    return refused('its renderFingerprint is not text')
  const lenses = byLensOf(record.lenses, 'arrangements', positionsOf)
  if ('problem' in lenses) return lenses
  const collapsed = byLensOf(record.collapsed, 'shut modules', idsOf)
  if ('problem' in collapsed) return collapsed
  const opened = byLensOf(record.opened, 'opened folds', idsOf)
  if ('problem' in opened) return opened
  const domains = byLensOf(record.domains, 'Domains drawn', sharesOf)
  if ('problem' in domains) return domains
  return {
    value: {
      ...(renderFingerprint === undefined ? {} : { renderFingerprint }),
      ...(lenses.value ? { lenses: lenses.value } : {}),
      ...(collapsed.value ? { collapsed: collapsed.value } : {}),
      ...(opened.value ? { opened: opened.value } : {}),
      ...(domains.value ? { domains: domains.value } : {}),
    },
  }
}

const POSITION: Shape = { record: { x: null, y: null, w: null, h: null } }

const LAYOUT: StateFile<LayoutState> = {
  name: 'layout.json',
  decode: layoutOf,
  shape: {
    record: {
      renderFingerprint: null,
      lenses: { map: { map: POSITION } },
      collapsed: null,
      opened: null,
      domains: null,
    },
  },
  empty: () => ({}),
}

/** The record; `UnreadableState` when the file is not read whole. */
export function readLayout(root: string): LayoutState {
  return stateOf(root, LAYOUT)
}

/** The record as `change` makes it, unless it then holds more than `LAYOUT_LIMITS`. */
function changeLayout(
  root: string,
  change: (current: LayoutState) => LayoutState,
): { readonly value: LayoutState } | LayoutRefusal {
  let refusal: LayoutRefusal | undefined
  const value = changeStateFile(root, LAYOUT, (current) => {
    const next = change(current)
    const checked = layoutOf(next)
    if ('problem' in checked) {
      refusal = checked
      return undefined
    }
    return next
  })
  return refusal ?? { value }
}

/** Merges positions into one lens's arrangement; every other lens keeps its own. */
export function setLensPositions(
  root: string,
  lens: string,
  updates: Record<string, NodePosition>,
  renderFingerprint?: string,
): { readonly value: LayoutState } | LayoutRefusal {
  return changeLayout(root, (current) => ({
    ...current,
    ...((renderFingerprint ?? current.renderFingerprint) === undefined
      ? {}
      : { renderFingerprint: renderFingerprint ?? current.renderFingerprint }),
    lenses: { ...current.lenses, [lens]: { ...current.lenses?.[lens], ...updates } },
  }))
}

/** A set of ids each lens keeps: its shut modules, its folds opened by hand. */
export type LensIds = 'collapsed' | 'opened'

/**
 * Adds ids to one lens's set of `kind` and removes others; every id not named, every other
 * lens and every other set keep what they had — so two tabs each shutting a module both stand.
 */
export function changeLensIds(
  root: string,
  kind: LensIds,
  lens: string,
  change: { readonly add: readonly string[]; readonly remove: readonly string[] },
): { readonly value: LayoutState } | LayoutRefusal {
  const removed = new Set(change.remove)
  return changeLayout(root, (current) => {
    const ids = new Set(current[kind]?.[lens] ?? [])
    for (const id of change.add) ids.add(id)
    for (const id of removed) ids.delete(id)
    return { ...current, [kind]: { ...current[kind], [lens]: [...ids].sort() } }
  })
}

/**
 * Says how one lens draws one other Domain; `reached` returns it to the default, drawing what the
 * canvas's own Domain reaches. Every other Domain and every other lens keep theirs.
 */
export function setDomainShare(
  root: string,
  lens: string,
  origin: string,
  share: DomainShare | 'reached',
): { readonly value: LayoutState } | LayoutRefusal {
  return changeLayout(root, (current) => {
    const { [origin]: _before, ...others } = current.domains?.[lens] ?? {}
    const shares = share === 'reached' ? others : { ...others, [origin]: share }
    const { [lens]: _lens, ...lenses } = current.domains ?? {}
    const domains = Object.keys(shares).length > 0 ? { ...lenses, [lens]: shares } : lenses
    const { domains: _all, ...rest } = current
    return { ...rest, ...(Object.keys(domains).length > 0 ? { domains } : {}) }
  })
}

/**
 * Forgets one lens's arrangement, so it is laid out automatically again; the rest stays, its
 * shut modules, opened folds and Domains drawn included: what is open and drawn is what the
 * reader reads, not where boxes stand.
 */
export function resetLensLayout(root: string, lens: string): LayoutState {
  return changeStateFile(root, LAYOUT, (current) => {
    const { [lens]: _forgotten, ...kept } = current.lenses ?? {}
    const { lenses: _all, ...rest } = current
    return { ...rest, ...(Object.keys(kept).length > 0 ? { lenses: kept } : {}) }
  })
}

/**
 * Forgets every arrangement this Studio made of the canvas, every lens's included; what it does
 * not know — an earlier Studio's `positions` — stays for that Studio.
 */
export function resetLayout(root: string): void {
  forgetStateFile(root, LAYOUT)
}
