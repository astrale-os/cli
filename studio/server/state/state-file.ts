/**
 * state-file.ts — a Studio state file the Studio changes: read whole or not at all, and never
 * written over unless it was read whole.
 *
 * A file is absent, read whole, or unreadable — not JSON, not UTF-8, a merge conflict left in
 * it, or an entry this Studio does not decode (one a newer Studio wrote, one edited by hand) —
 * and an unreadable file is said as such, with why and where, by the read and by every write:
 * a write refuses (`UnreadableState`, answered 409) rather than drop the entries it could not
 * read. A key this Studio does not know, on a record it does decode, is kept through every
 * rewrite, as `shape` locates it.
 *
 * A chat's file is one of these, by id, and so are a workspace's active-chat pointer and the
 * tabs' order (agent/chats.ts). Files a write replaces whole (a run's transcript) or that are
 * derived (a bundle cache) are read with `readJson` in store.ts, where an unreadable file is the
 * same as none.
 */
import type { StrictDecoder } from '../json'

import { asJsonRecord, parseJson } from '../json'
import { readStateBytes, removeState, statePath, writeJson } from './store'

/**
 * Where a record's known keys are, so the others are kept: a record by its known keys (`null`
 * for a value replaced whole), a list of records matched by one key, a map of records by key.
 */
export type Shape =
  | { readonly record: Readonly<Record<string, Shape | null>> }
  | { readonly list: Shape; readonly by: string }
  | { readonly map: Shape }

/** One state file the Studio changes. */
export interface StateFile<T> {
  /** its path in the state folder */
  readonly name: string
  readonly decode: StrictDecoder<T>
  readonly shape: Shape
  /** the value of a file not there yet */
  readonly empty: () => T
}

export type StateRead<T> =
  | { readonly status: 'absent' }
  | { readonly status: 'ok'; readonly value: T; readonly raw: unknown }
  | { readonly status: 'unreadable'; readonly reason: string; readonly path: string }

/** A state file the Studio did not read whole, and so does not write over. */
export class UnreadableState extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(
      `${path} cannot be read whole: ${reason}. The Studio leaves it as it is; fix it, then read again.`,
    )
    this.name = 'UnreadableState'
  }

  /** What a route answers, with status 409. */
  get body(): { error: string; unreadable: { path: string; reason: string } } {
    return { error: this.message, unreadable: { path: this.path, reason: this.reason } }
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true })
const CONFLICT = /^(?:<{7}|={7}|>{7})(?: |$)/m

/** Why `bytes` are not a JSON value, or the value. */
function parsed(bytes: Uint8Array): { value: unknown } | { reason: string } {
  let text: string
  try {
    text = UTF8.decode(bytes)
  } catch {
    return { reason: 'it is not UTF-8 text' }
  }
  if (CONFLICT.test(text)) return { reason: 'it holds an unresolved merge conflict' }
  const value = parseJson(text)
  if (value !== undefined) return { value }
  try {
    JSON.parse(text)
  } catch (error) {
    return { reason: `it is not JSON (${error instanceof Error ? error.message : String(error)})` }
  }
  return { reason: 'it is not JSON' }
}

export function readStateFile<T>(root: string, file: StateFile<T>): StateRead<T> {
  const bytes = readStateBytes(root, file.name)
  if (bytes === null) return { status: 'absent' }
  const path = statePath(root, file.name)
  const json = parsed(bytes)
  if ('reason' in json) return { status: 'unreadable', reason: json.reason, path }
  const decoded = file.decode(json.value)
  if ('problem' in decoded) return { status: 'unreadable', reason: decoded.problem, path }
  return { status: 'ok', value: decoded.value, raw: json.value }
}

/** The file's value, its empty value when it is not there; `UnreadableState` when not read whole. */
export function stateOf<T>(root: string, file: StateFile<T>): T {
  const read = readStateFile(root, file)
  if (read.status === 'unreadable') throw new UnreadableState(read.path, read.reason)
  return read.status === 'ok' ? read.value : file.empty()
}

/**
 * Changes the file: `change` is given its value as read whole (its empty value when it is not
 * there) and answers the next, which is written with every key this Studio does not know kept,
 * or nothing to leave the file as it is. Answers the value the file now holds. A file not read
 * whole is left as it is: `UnreadableState`.
 */
export function changeStateFile<T>(
  root: string,
  file: StateFile<T>,
  change: (current: T) => T | undefined,
): T {
  const read = readStateFile(root, file)
  if (read.status === 'unreadable') throw new UnreadableState(read.path, read.reason)
  const current = read.status === 'ok' ? read.value : file.empty()
  const next = change(current)
  if (next === undefined) return current
  writeJson(root, file.name, read.status === 'ok' ? keepUnknown(read.raw, next, file.shape) : next)
  return next
}

/**
 * Forgets every value this Studio knows in the file and keeps every key it does not — another
 * Studio's — removing the file when nothing is left. A file not read whole is left as it is.
 */
export function forgetStateFile<T>(root: string, file: StateFile<T>): void {
  const read = readStateFile(root, file)
  if (read.status === 'unreadable') throw new UnreadableState(read.path, read.reason)
  if (read.status === 'absent') return
  const kept = keepUnknown(read.raw, {}, file.shape)
  const left = asJsonRecord(kept)
  if (left && Object.keys(left).length > 0) writeJson(root, file.name, kept)
  else removeState(root, file.name)
}

/** `next`, with every key of `raw` that `shape` does not know put back where it was. */
export function keepUnknown(raw: unknown, next: unknown, shape: Shape): unknown {
  if ('list' in shape) {
    if (!Array.isArray(raw) || !Array.isArray(next)) return next
    const before = new Map<unknown, unknown>()
    for (const item of raw) {
      const key = asJsonRecord(item)?.[shape.by]
      if (key !== undefined) before.set(key, item)
    }
    return next.map((item) => {
      const key = asJsonRecord(item)?.[shape.by]
      return key === undefined ? item : keepUnknown(before.get(key), item, shape.list)
    })
  }
  const was = asJsonRecord(raw)
  const now = asJsonRecord(next)
  if (!was || !now) return next
  if ('map' in shape)
    return Object.fromEntries(
      Object.entries(now).map(([key, value]) => [key, keepUnknown(was[key], value, shape.map)]),
    )
  const known = shape.record
  const entries: [string, unknown][] = Object.entries(now).map(([key, value]) => {
    const inner = Object.hasOwn(known, key) ? known[key] : null
    return [key, inner ? keepUnknown(was[key], value, inner) : value]
  })
  for (const [key, value] of Object.entries(was))
    if (!Object.hasOwn(known, key) && !Object.hasOwn(now, key)) entries.push([key, value])
  return Object.fromEntries(entries)
}
