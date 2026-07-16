import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../domain'

import { readComments, upsertComment } from '../state/comments'
import { handleBridge, startBridge } from './bridge'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function handle(root: string, id: string): DomainHandle {
  return {
    id,
    root,
    configFile: join(root, 'astrale.config.ts'),
    domainFile: join(root, 'domain.ts'),
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex: join(root, 'schema/index.ts'),
  }
}

test('bridge keeps its bearer out of the harness command line', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-bridge-'))
  roots.push(root)

  const bridge = startBridge(
    handle(root, 'test-domain'),
    () => 'run',
    () => {},
  )
  const server = bridge.mcpServers[0]!
  const configPath = server.args?.at(-1)
  expect(server.name).toBe('domain-studio')
  expect(server.approvalMode).toBe('approve')
  expect(configPath).toBeTruthy()

  const config = JSON.parse(readFileSync(configPath!, 'utf8')) as { base: string; token: string }
  expect(server.args?.join(' ')).not.toContain(config.token)
  expect(config.base).toContain('/api/domain/test-domain/agent/bridge')
  expect(existsSync(configPath!)).toBe(true)
  expect(statSync(configPath!).mode & 0o777).toBe(0o600)

  bridge.dispose()
  expect(existsSync(configPath!)).toBe(false)
})

test('bridge authorizes one domain and applies live thread mutations', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'studio-bridge-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'studio-bridge-b-'))
  roots.push(rootA, rootB)
  const domainA = handle(rootA, 'domain-a')
  const domainB = handle(rootB, 'domain-b')
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

  const bridge = startBridge(
    domainA,
    () => 'run',
    () => {},
  )
  const configPath = bridge.mcpServers[0]!.args!.at(-1)!
  const { token } = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string }
  const replies: string[] = []
  const progress: string[] = []
  const notifications: string[] = []
  bridge.onReply((id, text) => replies.push(`${id}:${text}`))
  bridge.onProgress((text) => progress.push(text))
  const notify = (event: any) => notifications.push(`${event.type}:${event.domainId}`)
  const request = new Request('http://studio.test')

  const invalid = await handleBridge(
    domainA,
    'reply',
    request,
    { token: 'wrong', commentId: awaiting.id, text: 'forged' },
    notify,
  )
  const crossDomain = await handleBridge(
    domainB,
    'reply',
    request,
    { token, commentId: awaiting.id, text: 'forged' },
    notify,
  )
  expect([invalid.status, crossDomain.status]).toEqual([401, 401])
  expect(readComments(rootA).comments[0]!.thread).toHaveLength(1)

  const listed = await handleBridge(domainA, 'threads', request, { token }, notify)
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

  const replied = await handleBridge(
    domainA,
    'reply',
    request,
    {
      token,
      commentId: awaiting.id,
      text: 'done',
      resolve: true,
      closeNote: 'complete',
    },
    notify,
  )
  await handleBridge(domainA, 'progress', request, { token, text: 'working' }, notify)
  const raised = await handleBridge(
    domainA,
    'raise_question',
    request,
    { token, ref: 'class.Test.property.value', text: 'Which value?', options: ['A', 'B'] },
    notify,
  )

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
  const expired = await handleBridge(domainA, 'threads', request, { token }, notify)
  expect(expired.status).toBe(401)
})
