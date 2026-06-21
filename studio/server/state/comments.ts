/**
 * comments.ts — the comments / open-questions store. ALL persistence goes through
 * store.ts (writes are allow-listed to <domain>/.domain-studio/). The on-disk file
 * is `comments.json`, shaped { schemaVersion, comments: Comment[] }.
 *
 * Comments are annotate-compatible: each thread entry is
 *   { id, role:'user'|'author', type:'text'|'choice', text, options?, answer? }
 * and `kind` is derived from the FIRST thread entry's role
 * (author-seeded ⇒ 'question', else 'comment').
 */
import type { Comment, CommentStore, ThreadEntry } from '../../shared/types'

import { readJson, writeJson } from './store'

const FILE = 'comments.json'

const EMPTY: CommentStore = { schemaVersion: '', comments: [] }

export function readComments(root: string): CommentStore {
  const store = readJson<CommentStore>(root, FILE, { ...EMPTY })
  return {
    schemaVersion: store.schemaVersion ?? '',
    comments: Array.isArray(store.comments) ? store.comments : [],
  }
}

function persist(root: string, store: CommentStore): void {
  writeJson(root, FILE, store)
}

/** Derive `kind` from the first thread entry's role. */
function deriveKind(thread: ThreadEntry[]): Comment['kind'] {
  return thread[0]?.role === 'author' ? 'question' : 'comment'
}

function makeEntry(input: {
  role: ThreadEntry['role']
  type?: ThreadEntry['type']
  text: string
  options?: string[]
  answer?: string | null
}): ThreadEntry {
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
    anchorRefs: import('../../shared/types').AnchorRef[]
    text?: string
    firstRole?: 'user' | 'author'
    type?: 'text' | 'choice'
    options?: string[]
    schemaVersion?: string
  },
): Comment {
  const store = readComments(root)
  if (input.schemaVersion !== undefined) store.schemaVersion = input.schemaVersion

  // If id provided and exists → append a thread entry instead of creating.
  if (input.id) {
    const existing = store.comments.find((c) => c.id === input.id)
    if (existing) {
      const entry = makeEntry({
        role: input.firstRole ?? 'user',
        type: input.type,
        text: input.text ?? '',
        options: input.options,
      })
      existing.thread.push(entry)
      existing.kind = deriveKind(existing.thread)
      persist(root, store)
      return existing
    }
  }

  const role = input.firstRole ?? 'user'
  const firstEntry = makeEntry({
    role,
    type: input.type,
    text: input.text ?? '',
    options: input.options,
  })
  const comment: Comment = {
    id: input.id ?? crypto.randomUUID(),
    anchors: input.anchors,
    anchorRefs: input.anchorRefs,
    status: 'open',
    thread: [firstEntry],
    createdAt: new Date().toISOString(),
    kind: role === 'author' ? 'question' : 'comment',
  }
  store.comments.push(comment)
  persist(root, store)
  return comment
}

export function addThreadEntry(
  root: string,
  id: string,
  entry: {
    role: 'user' | 'author'
    type?: 'text' | 'choice'
    text: string
    options?: string[]
    answer?: string | null
  },
): Comment | null {
  const store = readComments(root)
  const comment = store.comments.find((c) => c.id === id)
  if (!comment) return null
  comment.thread.push(makeEntry(entry))
  comment.kind = deriveKind(comment.thread)
  persist(root, store)
  return comment
}

/** Edit the text of a single thread entry in place (the studio is single-user). */
export function editThreadEntry(
  root: string,
  id: string,
  entryId: string,
  text: string,
): Comment | null {
  const store = readComments(root)
  const comment = store.comments.find((c) => c.id === id)
  if (!comment) return null
  const entry = comment.thread.find((e) => e.id === entryId)
  if (!entry) return null
  entry.text = text
  persist(root, store)
  return comment
}

export function setStatus(
  root: string,
  id: string,
  status: 'open' | 'closed',
  closeNote?: string,
): Comment | null {
  const store = readComments(root)
  const comment = store.comments.find((c) => c.id === id)
  if (!comment) return null
  comment.status = status
  if (closeNote !== undefined) comment.closeNote = closeNote
  comment.kind = deriveKind(comment.thread)
  persist(root, store)
  return comment
}

export function deleteComment(root: string, id: string): boolean {
  const store = readComments(root)
  const idx = store.comments.findIndex((c) => c.id === id)
  if (idx === -1) return false
  store.comments.splice(idx, 1)
  persist(root, store)
  return true
}

/**
 * Mark a comment orphaned when NONE of its anchorRefs[].ref is present in
 * `validRefs`; clear the flag otherwise. Persists and returns the store.
 */
export function markOrphans(root: string, validRefs: string[]): CommentStore {
  const valid = new Set(validRefs)
  const store = readComments(root)
  for (const comment of store.comments) {
    const refs = comment.anchorRefs ?? []
    const anyValid = refs.some((r) => valid.has(r.ref))
    comment.orphaned = refs.length > 0 ? !anyValid : true
    comment.kind = deriveKind(comment.thread)
  }
  persist(root, store)
  return store
}

interface PastedThreadEntry {
  id?: string
  role?: 'user' | 'author'
  type?: 'text' | 'choice'
  text?: string
  options?: string[]
  answer?: string | null
}

interface PastedComment {
  id?: string
  anchors?: string[]
  status?: 'open' | 'closed'
  closeNote?: string
  thread?: PastedThreadEntry[]
}

interface PastedStore {
  schemaVersion?: string
  comments?: PastedComment[]
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

function normalizePastedEntry(e: PastedThreadEntry): ThreadEntry {
  const entry: ThreadEntry = {
    id: e.id && e.id.length > 0 ? e.id : crypto.randomUUID(),
    role: e.role === 'author' ? 'author' : 'user',
    type: e.type === 'choice' ? 'choice' : 'text',
    text: e.text ?? '',
  }
  if (e.options !== undefined) entry.options = e.options
  if (e.answer !== undefined) entry.answer = e.answer
  return entry
}

/**
 * Merge an agent-pasted machine-state reply (annotate shape) into the store.
 * - LAST ```json``` block is parsed.
 * - For each pasted comment by id: if known locally, append NEW thread entries
 *   (dedupe by entry id) and apply status/closeNote; if unknown → unknownIds.
 * - schemaMismatch when parsed.schemaVersion differs from currentSchemaHash.
 */
export function mergeReply(
  root: string,
  currentSchemaHash: string,
  pastedText: string,
  opts?: {
    /** live loop: skip ONLY the texts already applied live this run, per comment id */
    skipByComment?: Map<string, Set<string>>
    /** manual paste: dedupe author replies against the whole thread (a re-paste with
     *  regenerated ids would otherwise duplicate) — there are no live replies to scope to */
    dedupeAuthorText?: boolean
  },
): import('../../shared/types').MergeResult {
  const block = extractLastJsonBlock(pastedText)
  if (block == null) {
    throw new Error('no machine-state json block found in pasted text')
  }
  const parsed = JSON.parse(block) as PastedStore
  const pastedComments = Array.isArray(parsed.comments) ? parsed.comments : []

  const store = readComments(root)
  let merged = 0
  let closed = 0
  const unknownIds: string[] = []

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
    for (const pe of pc.thread ?? []) {
      const entry = normalizePastedEntry(pe)
      if (seen.has(entry.id)) continue
      if (
        entry.role === 'author' &&
        (liveTexts?.has(entry.text.trim()) || authorTexts?.has(entry.text.trim()))
      )
        continue
      seen.add(entry.id)
      if (entry.role === 'author') authorTexts?.add(entry.text.trim())
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

  persist(root, store)

  const pastedSchemaVersion = parsed.schemaVersion
  const schemaMismatch = Boolean(pastedSchemaVersion && pastedSchemaVersion !== currentSchemaHash)

  return {
    merged,
    closed,
    unknownIds,
    schemaMismatch,
    pastedSchemaVersion,
  }
}
