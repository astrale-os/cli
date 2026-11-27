import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addThreadEntry,
  briefedComments,
  deleteComment,
  markOrphans,
  mergeReply,
  readComments,
  setStatus,
  upsertComment,
} from './comments'
import { UnreadableState } from './state-file'
import { statePath, writeJson } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('each domain keeps its own comment store', () => {
  const [rootA, rootB] = ['a', 'b'].map((name) =>
    mkdtempSync(join(tmpdir(), `studio-comments-${name}-`)),
  )
  roots.push(rootA!, rootB!)
  const anchor = { anchors: ['A'], anchorRefs: [{ ref: 'class.A', kind: 'schema' as const }] }
  upsertComment(rootA!, { ...anchor, text: 'only in A' })
  expect(readComments(rootA!).comments.map((comment) => comment.thread[0]!.text)).toEqual([
    'only in A',
  ])
  expect(readComments(rootB!).comments).toEqual([])
})

const futureStore = () => ({
  schemaVersion: 'render-fingerprint',
  futureStoreField: { version: 2 },
  comments: [
    {
      id: 'kept',
      anchors: ['Thing'],
      anchorRefs: [{ ref: 'class.Thing', kind: 'schema', futureAnchorField: true }],
      status: 'open',
      thread: [
        { id: 'entry', role: 'author', type: 'text', text: 'A question', futureEntryField: true },
      ],
      createdAt: '2026-08-20T00:00:00.000Z',
      futureCommentField: true,
    },
  ],
})

test('a comment this Studio does not decode makes the file unreadable, and no write goes over it', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-comments-corrupt-'))
  roots.push(root)
  const path = statePath(root, 'comments.json')
  const unreadable = (reason: string) => {
    expect(() => readComments(root)).toThrow(new UnreadableState(path, reason))
    expect(() => upsertComment(root, { anchors: [], anchorRefs: [], text: 'new' })).toThrow(
      UnreadableState,
    )
    expect(() => addThreadEntry(root, 'kept', { role: 'user', text: 'more' })).toThrow(
      UnreadableState,
    )
    expect(() => setStatus(root, 'kept', 'closed')).toThrow(UnreadableState)
    expect(() => deleteComment(root, 'kept')).toThrow(UnreadableState)
    expect(() => markOrphans(root, [])).toThrow(UnreadableState)
    expect(() => mergeReply(root, '', '```json\n{"comments": []}\n```')).toThrow(UnreadableState)
    // the agent is still briefed, with none and why
    expect(briefedComments(root)).toEqual({
      schemaVersion: '',
      comments: [],
      unreadable: new UnreadableState(path, reason).message,
    })
  }
  const store = futureStore()
  const broken = (change: (comment: Record<string, unknown>) => void) => {
    const next = futureStore()
    change(next.comments[0] as Record<string, unknown>)
    return next
  }

  writeJson(root, 'comments.json', {
    ...store,
    comments: [...store.comments, { id: 42, thread: [] }],
  })
  unreadable('comment 2: it has no id')

  writeJson(
    root,
    'comments.json',
    broken((comment) => {
      comment.thread = [{ id: 'broken', role: 'nobody', type: 'text', text: 'by no one' }]
    }),
  )
  unreadable('comment 1 (kept): entry 1 is by a user or an author')

  const anchorless = broken((comment) => {
    comment.anchorRefs = [{ ref: 42, kind: 'schema' }]
  })
  writeJson(root, 'comments.json', anchorless)
  unreadable('comment 1 (kept): anchor 1: an anchor names its ref')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(anchorless)
})

test('a key this Studio does not know is kept through every rewrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-comments-future-'))
  roots.push(root)
  writeJson(root, 'comments.json', futureStore())
  expect(readComments(root).comments[0]).toEqual({
    id: 'kept',
    anchors: ['Thing'],
    anchorRefs: [{ ref: 'class.Thing', kind: 'schema' }],
    status: 'open',
    thread: [{ id: 'entry', role: 'author', type: 'text', text: 'A question' }],
    createdAt: '2026-08-20T00:00:00.000Z',
    kind: 'question',
  })
  const reply = addThreadEntry(root, 'kept', { role: 'user', text: 'An answer' })!.thread[1]!
  setStatus(root, 'kept', 'closed', 'answered')
  const written = JSON.parse(readFileSync(statePath(root, 'comments.json'), 'utf8'))
  const future = futureStore()
  expect(written).toEqual({
    ...future,
    comments: [
      {
        ...future.comments[0],
        status: 'closed',
        closeNote: 'answered',
        kind: 'question',
        thread: [...future.comments[0]!.thread, reply],
      },
    ],
  })
})

test('rejects a syntactically valid machine-state block with the wrong root shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-comments-paste-'))
  roots.push(root)

  expect(() => mergeReply(root, 'render-fingerprint', '```json\n[]\n```')).toThrow(
    'invalid machine-state json block',
  )
})

test('marking orphans persists only what changed: a read writes nothing into the Domain folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-comments-marks-'))
  roots.push(root)
  const file = statePath(root, 'comments.json')
  // no comments: nothing is written, not even an empty store
  expect(markOrphans(root, ['class.A']).comments).toEqual([])
  expect(existsSync(file)).toBe(false)

  upsertComment(root, {
    anchors: ['A'],
    anchorRefs: [{ ref: 'class.A', kind: 'schema' }],
    text: 'on A',
  })
  markOrphans(root, ['class.A'])
  const marked = statSync(file).mtimeMs
  expect(markOrphans(root, ['class.A']).comments[0]!.orphaned).toBe(false)
  expect(statSync(file).mtimeMs).toBe(marked)

  // a mark that changes is kept
  expect(markOrphans(root, ['class.B']).comments[0]!.orphaned).toBe(true)
  expect(readComments(root).comments[0]!.orphaned).toBe(true)
})
