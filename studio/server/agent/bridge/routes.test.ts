import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../../domain'

import { readComments, upsertComment } from '../../state/comments'
import { startBridge } from './grant'
import { handleBridge } from './routes'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function domain(root: string, id: string): DomainHandle {
  return {
    id,
    root,
    configFile: join(root, 'astrale.config.ts'),
    applicationFile: join(root, 'application.ts'),
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex: join(root, 'schema/index.ts'),
  }
}

test('authorizes one domain and applies live thread mutations', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'studio-bridge-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'studio-bridge-b-'))
  roots.push(rootA, rootB)
  const domainA = domain(rootA, 'domain-a')
  const domainB = domain(rootB, 'domain-b')
  const awaiting = upsertComment(rootA, {
    anchors: ['Test'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text: 'please answer',
  })
  upsertComment(rootA, {
    anchors: ['Agent question'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text: 'already answered by author',
    firstRole: 'author',
  })

  const notifications: string[] = []
  const bridge = startBridge(domainA, (event) =>
    notifications.push(`${event.type}:${'domainId' in event ? event.domainId : ''}`),
  )
  const configPath = bridge.mcpServers[0]!.args!.at(-1)!
  const { token } = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string }
  const replies: string[] = []
  const progress: string[] = []
  bridge.onReply((id, text) => replies.push(`${id}:${text}`))
  bridge.onProgress((text) => progress.push(text))
  const invalid = await handleBridge(domainA, 'reply', {
    token: 'wrong',
    commentId: awaiting.id,
    text: 'forged',
  })
  const crossDomain = await handleBridge(domainB, 'reply', {
    token,
    commentId: awaiting.id,
    text: 'forged',
  })
  expect([invalid.status, crossDomain.status]).toEqual([401, 401])
  expect(readComments(rootA).comments[0]!.thread).toHaveLength(1)

  const listed = await handleBridge(domainA, 'threads', { token })
  expect(await listed.json()).toEqual({
    threads: [
      {
        id: awaiting.id,
        kind: 'comment',
        anchor: 'class.Test',
        file: null,
        latest: 'please answer',
      },
    ],
  })

  const replied = await handleBridge(domainA, 'reply', {
    token,
    commentId: awaiting.id,
    text: 'done',
    resolve: true,
    closeNote: 'complete',
  })
  await handleBridge(domainA, 'progress', { token, text: 'working' })
  const raised = await handleBridge(domainA, 'raise_question', {
    token,
    ref: 'class.Test.property.value',
    text: 'Which value?',
    options: ['A', 'B'],
  })

  expect(await replied.json()).toEqual({ ok: true, resolved: true })
  expect(await raised.json()).toMatchObject({ ok: true })
  const comments = readComments(rootA).comments
  expect(comments[0]).toMatchObject({
    id: awaiting.id,
    status: 'closed',
    closeNote: 'complete',
  })
  expect(comments[0]!.thread.at(-1)).toMatchObject({ role: 'author', text: 'done' })
  expect(comments.at(-1)).toMatchObject({
    kind: 'question',
    status: 'open',
    thread: [{ role: 'author', type: 'choice', text: 'Which value?', options: ['A', 'B'] }],
  })
  expect(replies).toEqual([`${awaiting.id}:done`])
  expect(progress).toEqual(['working'])
  expect(notifications).toEqual(['comments:domain-a', 'comments:domain-a'])

  bridge.dispose()
  const expired = await handleBridge(domainA, 'threads', { token })
  expect(expired.status).toBe(401)
})

test('returns committed success when UI notification delivery fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-bridge-notify-'))
  roots.push(root)
  const handle = domain(root, 'domain-notify')
  const comment = upsertComment(root, {
    anchors: ['Test'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text: 'reply once',
  })
  const bridge = startBridge(handle, () => {
    throw new Error('listener failed')
  })
  const configPath = bridge.mcpServers[0]!.args!.at(-1)!
  const { token } = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string }

  const response = await handleBridge(handle, 'reply', {
    token,
    commentId: comment.id,
    text: 'committed',
  })

  expect(response.status).toBe(200)
  expect(readComments(root).comments[0]!.thread.map((entry) => entry.text)).toEqual([
    'reply once',
    'committed',
  ])
  bridge.dispose()
})
