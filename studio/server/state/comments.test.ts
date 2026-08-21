import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergeReply, readComments, upsertComment } from './comments'
import { writeJson } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('missing comment stores do not share entries across domains', () => {
  const rootA = mkdtempSync(join(tmpdir(), 'studio-comments-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'studio-comments-b-'))
  roots.push(rootA, rootB)

  upsertComment(rootA, {
    anchors: ['A'],
    anchorRefs: [{ ref: 'class.A', kind: 'schema' }],
    text: 'only in A',
  })

  expect(readComments(rootA).comments.map((comment) => comment.thread[0]!.text)).toEqual([
    'only in A',
  ])
  expect(readComments(rootB).comments).toEqual([])
})

test('normalizes malformed nested comment data and ignores future fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-comments-corrupt-'))
  roots.push(root)
  writeJson(root, 'comments.json', {
    schemaVersion: 'render-fingerprint',
    futureStoreField: { version: 2 },
    comments: [
      {
        id: 'kept',
        anchors: ['Thing'],
        anchorRefs: [
          { ref: 'class.Thing', kind: 'schema', futureAnchorField: true },
          { ref: 42, kind: 'schema' },
        ],
        status: 'open',
        thread: [
          {
            id: 'entry',
            role: 'author',
            type: 'text',
            text: 'A valid question',
            futureEntryField: true,
          },
          { id: 'broken', role: 'nobody', type: 'text', text: 'ignored' },
        ],
        createdAt: '2026-08-20T00:00:00.000Z',
        futureCommentField: true,
      },
      { id: 42, thread: [] },
    ],
  })

  expect(readComments(root)).toEqual({
    schemaVersion: 'render-fingerprint',
    comments: [
      {
        id: 'kept',
        anchors: ['Thing'],
        anchorRefs: [{ ref: 'class.Thing', kind: 'schema' }],
        status: 'open',
        thread: [
          {
            id: 'entry',
            role: 'author',
            type: 'text',
            text: 'A valid question',
          },
        ],
        createdAt: '2026-08-20T00:00:00.000Z',
        kind: 'question',
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
