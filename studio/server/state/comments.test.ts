import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readComments, upsertComment } from './comments'

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
