/**
 * comments.ts — the comments / open-questions store. ALL persistence goes through
 * store.ts (writes are allow-listed to <domain>/.domain-studio/). The on-disk file
 * is `comments.json`, shaped { schemaVersion, comments: Comment[] }.
 * `schemaVersion` is the historical annotate wire key for Studio's render
 * fingerprint; it is not a canonical DSL schema revision.
 *
 * Comments are annotate-compatible: each thread entry is
 *   { id, role:'user'|'author', type:'text'|'choice', text, options?, answer? }
 * and `kind` is derived from the FIRST thread entry's role
 * (author-seeded ⇒ 'question', else 'comment').
 *
 * The file is read whole or not at all (state-file.ts): a comment this Studio does not decode
 * makes it unreadable — said by the read, refused to every write — and a key it does not know,
 * on the store, a comment, an anchor or an entry, is kept through every rewrite.
 */
import type {
  AnchorRef,
  Comment,
  CommentStore,
  MergeResult,
  ThreadEntry,
} from '../../shared/contracts/workspace'

import {
  asJsonRecord,
  asString,
  asStringArray,
  decodeEach,
  parseJson,
  refused,
  type Decoded,
} from '../json'
import {
  changeStateFile,
  readStateFile,
  stateOf,
  UnreadableState,
  type Shape,
  type StateFile,
} from './state-file'

const isString = (value: unknown): value is string => typeof value === 'string'
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)
const isLine = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
/** Absent, or what `is` admits. */
const optional =
  <T>(is: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || is(value)

const ANCHOR_KINDS: readonly string[] = ['schema', 'section', 'file']

/** An anchor as it is written, or why not. */
export function anchorRefOf(value: unknown): Decoded<AnchorRef> {
  const record = asJsonRecord(value)
  if (!record) return refused('an anchor is an object')
  const { ref, kind, file, startLine, endLine, label } = record
  if (!isString(ref) || ref.length === 0) return refused('an anchor names its ref')
  if (!isString(kind) || !ANCHOR_KINDS.includes(kind))
    return refused(`the anchor ${ref} is of kind schema, section or file`)
  if (!optional(isString)(file) || !optional(isString)(label))
    return refused(`the anchor ${ref} has a file or a label that is not text`)
  if (!optional(isLine)(startLine) || !optional(isLine)(endLine))
    return refused(`the anchor ${ref} has a line that is not a number`)
  return {
    value: {
      ref,
      kind: kind as AnchorRef['kind'],
      ...(file === undefined ? {} : { file }),
      ...(startLine === undefined ? {} : { startLine }),
      ...(endLine === undefined ? {} : { endLine }),
      ...(label === undefined ? {} : { label }),
    },
  }
}

/** An anchor a request carries, or nothing when it does not decode. */
export function decodeAnchorRef(value: unknown): AnchorRef | undefined {
  const decoded = anchorRefOf(value)
  return 'value' in decoded ? decoded.value : undefined
}

export function decodeAnchorRefs(value: unknown): AnchorRef[] {
  return decodeEach(value, decodeAnchorRef) ?? []
}

function threadEntryOf(value: unknown, at: string): Decoded<ThreadEntry> {
  const record = asJsonRecord(value)
  if (!record) return refused(`${at} is not an object`)
  const { id, role, type, text, options, answer } = record
  if (!isString(id) || id.length === 0) return refused(`${at} has no id`)
  if (role !== 'user' && role !== 'author') return refused(`${at} is by a user or an author`)
  if (type !== 'text' && type !== 'choice') return refused(`${at} is text or a choice`)
  if (!isString(text)) return refused(`${at} has no text`)
  if (!optional(isStrings)(options)) return refused(`${at} has options that are not text`)
  if (answer !== undefined && answer !== null && !isString(answer))
    return refused(`${at} has an answer that is not text`)
  return {
    value: {
      id,
      role,
      type,
      text,
      ...(options === undefined ? {} : { options }),
      ...(answer === undefined ? {} : { answer }),
    },
  }
}

/** Every item of a list absent or decoded, or the first one that does not decode. */
function eachOf<T>(
  value: unknown,
  decode: (item: unknown, at: string) => Decoded<T>,
  noun: string,
): Decoded<T[]> {
  if (value === undefined) return { value: [] }
  if (!Array.isArray(value)) return refused(`its ${noun}s are not a list`)
  const items: T[] = []
  for (const [index, item] of value.entries()) {
    const decoded = decode(item, `${noun} ${index + 1}`)
    if ('problem' in decoded) return decoded
    items.push(decoded.value)
  }
  return { value: items }
}

function commentOf(value: unknown): Decoded<Comment> {
  const record = asJsonRecord(value)
  if (!record) return refused('it is not an object')
  const { id, anchors, status, closeNote, createdAt, orphaned } = record
  if (!isString(id) || id.length === 0) return refused('it has no id')
  if (!optional(isStrings)(anchors)) return refused('its anchors are not text')
  if (status !== undefined && status !== 'open' && status !== 'closed')
    return refused('it is open or closed')
  if (!optional(isString)(closeNote) || !optional(isString)(createdAt))
    return refused('its close note or creation time is not text')
  if (orphaned !== undefined && typeof orphaned !== 'boolean')
    return refused('its orphaned mark is not true or false')
  const anchorRefs = eachOf(
    record.anchorRefs,
    (item, at) => {
      const anchor = anchorRefOf(item)
      return 'problem' in anchor ? refused(`${at}: ${anchor.problem}`) : anchor
    },
    'anchor',
  )
  if ('problem' in anchorRefs) return anchorRefs
  const thread = eachOf(record.thread, threadEntryOf, 'entry')
  if ('problem' in thread) return thread
  return {
    value: {
      id,
      anchors: anchors ?? [],
      anchorRefs: anchorRefs.value,
      status: status ?? 'open',
      thread: thread.value,
      createdAt: createdAt ?? '',
      kind: deriveKind(thread.value),
      ...(closeNote === undefined ? {} : { closeNote }),
      ...(orphaned === undefined ? {} : { orphaned }),
    },
  }
}

function commentStoreOf(value: unknown): Decoded<CommentStore> {
  const record = asJsonRecord(value)
  if (!record) return refused('it holds no object')
  if (!optional(isString)(record.schemaVersion)) return refused('its schemaVersion is not text')
  const comments = eachOf(
    record.comments,
    (item, at) => {
      const comment = commentOf(item)
      const id = asString(asJsonRecord(item)?.id)
      return 'problem' in comment
        ? refused(`${at}${id ? ` (${id})` : ''}: ${comment.problem}`)
        : comment
    },
    'comment',
  )
  if ('problem' in comments) return comments
  return { value: { schemaVersion: record.schemaVersion ?? '', comments: comments.value } }
}

const ENTRY: Shape = {
  record: { id: null, role: null, type: null, text: null, options: null, answer: null },
}
const ANCHOR: Shape = {
  record: { ref: null, kind: null, file: null, startLine: null, endLine: null, label: null },
}
const COMMENT: Shape = {
  record: {
    id: null,
    anchors: null,
    anchorRefs: { list: ANCHOR, by: 'ref' },
    status: null,
    closeNote: null,
    thread: { list: ENTRY, by: 'id' },
    createdAt: null,
    kind: null,
    orphaned: null,
  },
}

const COMMENTS: StateFile<CommentStore> = {
  name: 'comments.json',
  decode: commentStoreOf,
  shape: { record: { schemaVersion: null, comments: { list: COMMENT, by: 'id' } } },
  // a fresh array for every missing store: a shared one would leak across Domains
  empty: () => ({ schemaVersion: '', comments: [] }),
}

/** Every comment of the Domain; `UnreadableState` when the file is not read whole. */
export function readComments(root: string): CommentStore {
  return stateOf(root, COMMENTS)
}

/**
 * The comments the agent is briefed with: every one, or none with the reason when the file is
 * not read whole — a turn still runs, so the agent can be asked to repair it; what it writes
 * back is refused like any other write.
 */
export function briefedComments(root: string): CommentStore & { unreadable?: string } {
  const read = readStateFile(root, COMMENTS)
  if (read.status === 'unreadable')
    return {
      ...COMMENTS.empty(),
      unreadable: new UnreadableState(read.path, read.reason).message,
    }
  return read.status === 'ok' ? read.value : COMMENTS.empty()
}

/** Changes the store as read whole; nothing is written when `change` answers false. */
function changeComments(root: string, change: (store: CommentStore) => boolean): CommentStore {
  return changeStateFile(root, COMMENTS, (store) => (change(store) ? store : undefined))
}

/** Derive `kind` from the first thread entry's role. */
function deriveKind(thread: ThreadEntry[]): Comment['kind'] {
  return thread[0]?.role === 'author' ? 'question' : 'comment'
}

/** A new thread entry as callers describe it: the store assigns the id, `type` defaults to text. */
type NewThreadEntry = Omit<ThreadEntry, 'id' | 'type'> & { type?: ThreadEntry['type'] }

function makeEntry(input: NewThreadEntry): ThreadEntry {
  const entry: ThreadEntry = {
    id: crypto.randomUUID(),
    role: input.role,
    type: input.type ?? 'text',
    text: input.text,
  }
  if (input.options !== undefined) entry.options = input.options
  if (input.answer !== undefined) entry.answer = input.answer
  return entry
}

export function upsertComment(
  root: string,
  input: {
    id?: string
    anchors: string[]
    anchorRefs: AnchorRef[]
    text?: string
    firstRole?: ThreadEntry['role']
    type?: ThreadEntry['type']
    options?: string[]
    schemaVersion?: string
  },
): Comment {
  const entry = makeEntry({
    role: input.firstRole ?? 'user',
    type: input.type,
    text: input.text ?? '',
    options: input.options,
  })
  let upserted: Comment | undefined
  changeComments(root, (store) => {
    if (input.schemaVersion !== undefined) store.schemaVersion = input.schemaVersion
    // If id provided and exists → append a thread entry instead of creating.
    const existing = input.id ? store.comments.find((c) => c.id === input.id) : undefined
    if (existing) {
      existing.thread.push(entry)
      existing.kind = deriveKind(existing.thread)
      upserted = existing
      return true
    }
    upserted = {
      id: input.id ?? crypto.randomUUID(),
      anchors: input.anchors,
      anchorRefs: input.anchorRefs,
      status: 'open',
      thread: [entry],
      createdAt: new Date().toISOString(),
      kind: deriveKind([entry]),
    }
    store.comments.push(upserted)
    return true
  })
  return upserted!
}

export function addThreadEntry(root: string, id: string, entry: NewThreadEntry): Comment | null {
  let changed: Comment | null = null
  changeComments(root, (store) => {
    const comment = store.comments.find((c) => c.id === id)
    if (!comment) return false
    comment.thread.push(makeEntry(entry))
    comment.kind = deriveKind(comment.thread)
    changed = comment
    return true
  })
  return changed
}

export function setStatus(
  root: string,
  id: string,
  status: Comment['status'],
  closeNote?: string,
): Comment | null {
  let changed: Comment | null = null
  changeComments(root, (store) => {
    const comment = store.comments.find((c) => c.id === id)
    if (!comment) return false
    comment.status = status
    if (closeNote !== undefined) comment.closeNote = closeNote
    comment.kind = deriveKind(comment.thread)
    changed = comment
    return true
  })
  return changed
}

export function deleteComment(root: string, id: string): boolean {
  let deleted = false
  changeComments(root, (store) => {
    const idx = store.comments.findIndex((c) => c.id === id)
    if (idx === -1) return false
    store.comments.splice(idx, 1)
    deleted = true
    return true
  })
  return deleted
}

/**
 * Mark a comment orphaned when NONE of its anchorRefs[].ref is present in
 * `validRefs`; clear the flag otherwise. Returns the store, and persists it only when a mark
 * changed: reading a Domain's comments writes nothing into its folder.
 */
export function markOrphans(root: string, validRefs: string[]): CommentStore {
  const valid = new Set(validRefs)
  return changeComments(root, (store) => {
    let changed = false
    for (const comment of store.comments) {
      const refs = comment.anchorRefs ?? []
      const orphaned = refs.length > 0 ? !refs.some((r) => valid.has(r.ref)) : true
      const kind = deriveKind(comment.thread)
      if (comment.orphaned !== orphaned || comment.kind !== kind) changed = true
      comment.orphaned = orphaned
      comment.kind = kind
    }
    return changed
  })
}

/** A comment as an agent pastes it back: only its id is needed to merge it. */
type PastedComment = Partial<Pick<Comment, 'id' | 'anchors' | 'status' | 'closeNote' | 'thread'>>

interface PastedStore {
  schemaVersion?: string
  comments?: PastedComment[]
}

/** A pasted thread entry, completed: a missing id is minted, role and type default. */
function decodePastedEntry(value: unknown): ThreadEntry | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const options = asStringArray(record.options)
  const answer = record.answer === null ? null : asString(record.answer)
  return {
    id: asString(record.id) || crypto.randomUUID(),
    role: record.role === 'author' ? 'author' : 'user',
    type: record.type === 'choice' ? 'choice' : 'text',
    text: asString(record.text) ?? '',
    ...(options === undefined ? {} : { options }),
    ...(answer === undefined ? {} : { answer }),
  }
}

function decodePastedComment(value: unknown): PastedComment | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const id = asString(record.id)
  const anchors = asStringArray(record.anchors)
  const status = record.status === 'open' || record.status === 'closed' ? record.status : undefined
  const closeNote = asString(record.closeNote)
  const thread = decodeEach(record.thread, decodePastedEntry)
  return {
    ...(id === undefined ? {} : { id }),
    ...(anchors === undefined ? {} : { anchors }),
    ...(status === undefined ? {} : { status }),
    ...(closeNote === undefined ? {} : { closeNote }),
    ...(thread === undefined ? {} : { thread }),
  }
}

function decodePastedStore(value: unknown): PastedStore | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const schemaVersion = asString(record.schemaVersion)
  const comments = decodeEach(record.comments, decodePastedComment)
  return {
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    ...(comments === undefined ? {} : { comments }),
  }
}

/** Extract the LAST fenced ```json … ``` block from arbitrary prose. */
function extractLastJsonBlock(text: string): string | null {
  const fence = /```json\s*\n?([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = fence.exec(text)) !== null) {
    last = match[1]
  }
  return last == null ? null : last.trim()
}

interface MergeOptions {
  /** live loop: skip ONLY the texts already applied live this run, per comment id */
  skipByComment?: Map<string, Set<string>>
  /** manual paste: dedupe author replies against the whole thread (a re-paste with
   *  regenerated ids would otherwise duplicate) — there are no live replies to scope to */
  dedupeAuthorText?: boolean
}

/**
 * The machine-state reply an agent pasted — the LAST ```json``` block of its text.
 * Throws when there is none, or when it is not the annotate shape.
 */
export function parseReplyBlock(pastedText: string): PastedStore {
  const block = extractLastJsonBlock(pastedText)
  if (block == null) {
    throw new Error('no machine-state json block found in pasted text')
  }
  const parsed = decodePastedStore(parseJson(block))
  if (!parsed) throw new Error('invalid machine-state json block')
  return parsed
}

/**
 * Merge an agent-pasted machine-state reply (annotate shape) into the store.
 * - LAST ```json``` block is parsed.
 * - For each pasted comment by id: if known locally, append NEW thread entries
 *   (dedupe by entry id) and apply status/closeNote; if unknown → unknownIds.
 * - schemaMismatch when parsed.schemaVersion differs from the current render fingerprint.
 */
export function mergeReply(
  root: string,
  currentRenderFingerprint: string,
  pastedText: string,
  opts?: MergeOptions,
): MergeResult {
  return mergeParsedReply(root, currentRenderFingerprint, parseReplyBlock(pastedText), opts)
}

/**
 * Merge an already-parsed reply into ONE store. A turn that briefed several domains
 * parses the block once and applies it to each of them: every store keeps the entries
 * whose ids it holds and reports the rest as unknown.
 */
export function mergeParsedReply(
  root: string,
  currentRenderFingerprint: string,
  parsed: PastedStore,
  opts?: MergeOptions,
): MergeResult {
  const pastedComments = parsed.comments ?? []
  let merged = 0
  let closed = 0
  const unknownIds: string[] = []

  changeComments(root, (store) => {
    for (const pc of pastedComments) {
      if (!pc.id) {
        unknownIds.push('')
        continue
      }
      const local = store.comments.find((c) => c.id === pc.id)
      if (!local) {
        unknownIds.push(pc.id)
        continue
      }

      const seen = new Set(local.thread.map((t) => t.id))
      // Skip ONLY the author texts already applied LIVE this run (the agent regenerates
      // ids, so id-dedupe alone wouldn't catch a bridge reply echoed in the block). Scope
      // it to this run — NOT the whole thread history — so a legitimately-repeated reply
      // across turns ("Done." twice) is never dropped.
      const liveTexts = opts?.skipByComment?.get(pc.id)
      const authorTexts = opts?.dedupeAuthorText
        ? new Set(local.thread.filter((t) => t.role === 'author').map((t) => t.text.trim()))
        : null
      let appended = 0
      for (const entry of pc.thread ?? []) {
        if (seen.has(entry.id)) continue
        if (entry.role === 'author') {
          const text = entry.text.trim()
          if (liveTexts?.has(text) || authorTexts?.has(text)) continue
          authorTexts?.add(text)
        }
        seen.add(entry.id)
        local.thread.push(entry)
        appended += 1
      }
      if (appended > 0) merged += 1

      // Only ever close from a merge — never REOPEN a thread the user closed mid-run.
      if (pc.status === 'closed' && local.status !== 'closed') {
        local.status = 'closed'
        closed += 1
      }
      if (pc.closeNote !== undefined) local.closeNote = pc.closeNote

      local.kind = deriveKind(local.thread)
    }
    return true
  })

  const pastedSchemaVersion = parsed.schemaVersion
  return {
    merged,
    closed,
    unknownIds,
    schemaMismatch: Boolean(
      pastedSchemaVersion && pastedSchemaVersion !== currentRenderFingerprint,
    ),
    pastedSchemaVersion,
  }
}
