/**
 * Notices about the place a reader was sent to, said once that place is on screen. An address
 * that named something gone lands the reader elsewhere, and the notice that says so waits for
 * the level it concerns to draw, its reads in, rather than passing while it still loads.
 *
 * - A level says it is on screen (`useOnScreen`) once what it reads has answered, and stops
 *   saying it when it unmounts.
 * - A notice is said when its place is on screen; with no place, at the first place that is; and
 *   at whatever place draws next once the reader has moved on before its place drew.
 * - It stays as long as its words take to read, longer while hovered, until the reader closes it.
 *   The same words are one notice.
 */

import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'

/** A level of the Studio, of one Domain past the Workspace. */
export type Place =
  | { readonly level: 'workspace' }
  | { readonly level: 'domain' | 'data'; readonly domainId: string }

interface Waiting {
  readonly message: string
  readonly place?: Place
  /** how many places were drawn when it was asked: one drawn later is where the reader went */
  readonly after: number
}

interface Board {
  /** the place on screen, numbered in the order places are drawn */
  readonly drawn?: { readonly place: Place; readonly number: number }
  /** how many places have been drawn on this page */
  readonly drawnCount: number
  readonly waiting: readonly Waiting[]
}

const board = create<Board>(() => ({ drawnCount: 0, waiting: [] }))

const placeKey = (place: Place) =>
  place.level === 'workspace' ? 'workspace' : `${place.level}:${place.domainId}`

/** How long a notice stays: time to see it, then time to read its words, at most 20 s. */
export function readingTimeMs(message: string): number {
  const words = message.split(/\s+/).filter(Boolean).length
  return Math.min(20_000, 5_000 + words * 300)
}

function say(message: string): void {
  toast.warning(message, { id: `notice:${message}`, duration: readingTimeMs(message) })
}

/** Says every notice whose place is on screen, or that the reader has moved past. */
function sayDue(): void {
  const { drawn, waiting } = board.getState()
  if (!drawn || waiting.length === 0) return
  const here = placeKey(drawn.place)
  const due = waiting.filter(
    (one) => !one.place || placeKey(one.place) === here || one.after < drawn.number,
  )
  if (due.length === 0) return
  board.setState({ waiting: waiting.filter((one) => !due.includes(one)) })
  for (const one of due) say(one.message)
}

/** Says `message` once `place` is on screen; with no place, once any place is. */
export function sayOnScreen(message: string, place?: Place): void {
  const { waiting, drawnCount } = board.getState()
  if (waiting.some((one) => one.message === message)) return
  board.setState({
    waiting: [...waiting, { message, ...(place ? { place } : {}), after: drawnCount }],
  })
  sayDue()
}

/** Marks `place` on screen while the caller is mounted with it; `undefined` marks nothing. */
export function useOnScreen(place: Place | undefined): void {
  const level = place?.level
  const domainId = place && place.level !== 'workspace' ? place.domainId : undefined
  useEffect(() => {
    if (level === undefined) return
    const shown: Place =
      level === 'workspace' || domainId === undefined ? { level: 'workspace' } : { level, domainId }
    const number = board.getState().drawnCount + 1
    board.setState({ drawn: { place: shown, number }, drawnCount: number })
    sayDue()
    return () => {
      if (board.getState().drawn?.number === number) board.setState({ drawn: undefined })
    }
  }, [domainId, level])
}

/** `useOnScreen` as an element, for a level drawn in a Suspense boundary. */
export function OnScreen({ place }: { place: Place }): null {
  useOnScreen(place)
  return null
}
