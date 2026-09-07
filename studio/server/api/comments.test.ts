import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../domain'

import { readComments, upsertComment } from '../state/comments'
import { handleCommentRoute } from './comments'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('comment entries are immutable through the HTTP API', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-comments-api-'))
  roots.push(root)
  const comment = upsertComment(root, {
    anchors: ['Order'],
    anchorRefs: [{ ref: 'class.Order', kind: 'schema' }],
    text: 'Keep this wording',
  })
  const handle: DomainHandle = {
    id: 'orders',
    root,
    configFile: join(root, 'astrale.config.ts'),
    applicationFile: join(root, 'application.ts'),
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex: join(root, 'schema/index.ts'),
  }
  const url = new URL('http://studio.test/api/domain/orders/comments')

  const response = await handleCommentRoute({
    req: new Request(url, { method: 'POST' }),
    url,
    rest: '/comments',
    body: {
      action: 'edit',
      id: comment.id,
      entryId: comment.thread[0]!.id,
      text: 'Rewritten',
    },
    handle,
    notify: () => {},
  })

  expect(response?.status).toBe(400)
  expect(await response?.json()).toEqual({ error: 'comment entries cannot be edited' })
  expect(readComments(root).comments[0]!.thread[0]!.text).toBe('Keep this wording')
})
