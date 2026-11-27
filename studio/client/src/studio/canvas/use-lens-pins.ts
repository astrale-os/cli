/**
 * One lens's arrangement of one canvas, kept in that canvas's layout record under the lens:
 * a Domain's record (by Domain id), the Kernel's, or the Workspace map's (`WORKSPACE_MAP_ID`).
 * What the reader placed, which modules they shut and which folds they opened are remembered
 * across reloads and restarts, in every browser that reads the record, and no lens shares
 * another's. Auto-arrange forgets the placements only: which are open is what the reader reads.
 *
 * A change shows at once — the record is updated in place before the server hears of it —
 * and reaches the server in the order it was made, so a reset never lands ahead of a
 * placement made before it, nor a placement ahead of the reset that discards it. What is shut
 * or opened reaches the server as what changed, never the whole set, so two tabs each shutting
 * a module both stand.
 */

import type { LayoutState, NodePosition } from '@shared/contracts/workspace'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { api, qk } from '@/lib/api'
import { layoutQueryOptions } from '@/lib/domain-queries'

import type { Pins } from './pins'

/** Each record's writes, chained so they reach the server one after another. */
const writes = new Map<string, Promise<unknown>>()

function inOrder(recordId: string, write: () => Promise<unknown>, onError: () => void) {
  const next = (writes.get(recordId) ?? Promise.resolve()).then(write).catch(onError)
  writes.set(recordId, next)
}

/** Positions are recorded to the hundredth of a unit: what reads back is what was shown. */
const round = (value: number) => Math.round(value * 100) / 100

const EMPTY: Pins = new Map()

export interface LensPins {
  /** whether the record has been read (or could not be): until then nothing placed is known */
  ready: boolean
  pins: Pins
  /** Records boxes where they stand now; boxes not named keep what they had. */
  place: (pins: Pins) => void
  /** Forgets the lens's arrangement and returns what it was, to put back on undo. */
  reset: () => Pins
  /** The modules the reader shut, sorted; none until they shut or open one. */
  collapsed: readonly string[] | undefined
  /**
   * Records the modules shut now, all of them, against those `shown` shut before: where the
   * record holds none yet, what the canvas showed (its default) is what the change is from.
   */
  collapse: (groups: readonly string[], shown?: Iterable<string>) => void
  /** The folds the reader opened by hand, each laid out open until they shut it. */
  opened: ReadonlySet<string>
  /** Opens a shut fold, or shuts an open one. */
  toggleFold: (fold: string) => void
}

const NONE_OPENED: ReadonlySet<string> = new Set()

/** How a change to each set of ids a lens keeps is written: what it adds and what it removes. */
const WRITE = {
  collapsed: api.changeLensCollapsed,
  opened: api.changeLensOpened,
} as const

/** `recordId` names the layout record: a Domain's id, the Kernel's, or `WORKSPACE_MAP_ID`. */
export function useLensPins(recordId: string, lens: string): LensPins {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery(layoutQueryOptions(recordId))
  const saved = data?.lenses?.[lens]
  const collapsed = data?.collapsed?.[lens]
  const openedList = data?.opened?.[lens]
  const opened = useMemo(() => (openedList ? new Set(openedList) : NONE_OPENED), [openedList])
  const pins = useMemo<Pins>(
    () =>
      saved
        ? new Map(
            Object.entries(saved).map(([id, position]) => [id, { x: position.x, y: position.y }]),
          )
        : EMPTY,
    [saved],
  )

  const resync = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: qk.layout(recordId) }),
    [recordId, queryClient],
  )

  const place = useCallback(
    (next: Pins) => {
      const current = queryClient.getQueryData<LayoutState>(qk.layout(recordId))?.lenses?.[lens]
      const changed: Record<string, NodePosition> = {}
      for (const [id, pin] of next) {
        const position = { x: round(pin.x), y: round(pin.y) }
        const before = current?.[id]
        if (!before || before.x !== position.x || before.y !== position.y) changed[id] = position
      }
      if (Object.keys(changed).length === 0) return
      queryClient.setQueryData<LayoutState>(qk.layout(recordId), (layout) => ({
        ...layout,
        lenses: { ...layout?.lenses, [lens]: { ...layout?.lenses?.[lens], ...changed } },
      }))
      inOrder(recordId, () => api.setLensLayout(recordId, lens, changed), resync)
    },
    [recordId, lens, queryClient, resync],
  )

  const reset = useCallback((): Pins => {
    const layout = queryClient.getQueryData<LayoutState>(qk.layout(recordId))
    const { [lens]: forgotten, ...kept } = layout?.lenses ?? {}
    queryClient.setQueryData<LayoutState>(qk.layout(recordId), {
      ...layout,
      lenses: kept,
    })
    inOrder(recordId, () => api.resetLensLayout(recordId, lens), resync)
    return new Map(
      Object.entries(forgotten ?? {}).map(([id, position]) => [
        id,
        { x: position.x, y: position.y },
      ]),
    )
  }, [recordId, lens, queryClient, resync])

  // A set as it reads now: shown at once whole; written in order as what it adds and removes,
  // so what another tab changed meanwhile stands; nothing written when it says the same. Where
  // the record holds no set yet, the first write holds all of it: every id it keeps is added,
  // and what was `shown` before but is not kept is removed, so the record holds a set even when
  // it is empty.
  const record = useCallback(
    (kind: keyof typeof WRITE, next: readonly string[], shown?: Iterable<string>) => {
      const ids = [...new Set(next)].sort()
      const current = queryClient.getQueryData<LayoutState>(qk.layout(recordId))?.[kind]?.[lens]
      const before = new Set(current ?? shown ?? [])
      const add = current ? ids.filter((id) => !before.has(id)) : ids
      const remove = [...before].filter((id) => !ids.includes(id))
      if (add.length === 0 && remove.length === 0) return
      queryClient.setQueryData<LayoutState>(qk.layout(recordId), (layout) => ({
        ...layout,
        [kind]: { ...layout?.[kind], [lens]: ids },
      }))
      inOrder(recordId, () => WRITE[kind](recordId, lens, { add, remove }), resync)
    },
    [recordId, lens, queryClient, resync],
  )
  const collapse = useCallback(
    (groups: readonly string[], shown?: Iterable<string>) => record('collapsed', groups, shown),
    [record],
  )
  const toggleFold = useCallback(
    (fold: string) => {
      const before =
        queryClient.getQueryData<LayoutState>(qk.layout(recordId))?.opened?.[lens] ?? []
      record(
        'opened',
        before.includes(fold) ? before.filter((one) => one !== fold) : [...before, fold],
      )
    },
    [lens, queryClient, record, recordId],
  )

  return { ready: !isPending, pins, place, reset, collapsed, collapse, opened, toggleFold }
}
