import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../../domain'
import type { AgentWorkspace } from '../workspace'

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

function workspace(root: string, domains: DomainHandle[]): AgentWorkspace {
  return {
    root,
    stateRoot: join(root, 'machine-agent'),
    uiRoot: join(root, 'machine-ui'),
    key: 'bridge-workspace',
    domains,
  }
}

test('authorizes one workspace and routes live thread mutations to their domain', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'studio-bridge-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'studio-bridge-b-'))
  roots.push(rootA, rootB)
  const domainA = domain(rootA, 'domain-a')
  const domainB = domain(rootB, 'domain-b')
  const agentWorkspace = workspace(rootA, [domainA, domainB])
  const awaiting = upsertComment(rootA, {
    anchors: ['Test'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text: 'please answer',
  })
  const asked = upsertComment(rootA, {
    anchors: ['Agent question'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text: 'already answered by author',
    firstRole: 'author',
  })

  const notifications: string[] = []
  const bridge = startBridge(agentWorkspace, (event) =>
    notifications.push(`${event.type}:${'domainId' in event ? event.domainId : ''}`),
  )
  const configPath = bridge.mcpServers[0]!.args!.at(-1)!
  const { token } = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string }
  const replies: string[] = []
  const progress: string[] = []
  bridge.onReply((id, text) => replies.push(`${id}:${text}`))
  bridge.onProgress((text) => progress.push(text))
  const invalid = await handleBridge('reply', {
    token: 'wrong',
    commentId: awaiting.id,
    text: 'forged',
  })
  expect(invalid.status).toBe(401)
  expect(readComments(rootA).comments[0]!.thread).toHaveLength(1)

  const listed = await handleBridge('threads', { token })
  expect(await listed.json()).toEqual({
    threads: [
      {
        id: awaiting.id,
        domain: 'domain-a',
        path: '.',
        kind: 'comment',
        anchor: 'class.Test',
        file: null,
        latest: 'please answer',
        waitingOn: 'agent',
      },
      {
        id: asked.id,
        domain: 'domain-a',
        path: '.',
        kind: 'question',
        anchor: 'class.Test',
        file: null,
        latest: 'already answered by author',
        waitingOn: 'user',
      },
    ],
  })

  const filtered = await handleBridge('threads', { token, domain: 'domain-b' })
  expect(await filtered.json()).toEqual({ threads: [] })

  const replied = await handleBridge('reply', {
    token,
    commentId: awaiting.id,
    text: 'done',
    resolve: true,
    closeNote: 'complete',
  })
  await handleBridge('progress', { token, text: 'working' })
  const raised = await handleBridge('raise_question', {
    token,
    domain: 'domain-a',
    ref: 'class.Test.property.value',
    text: 'Which value?',
    options: ['A', 'B'],
  })
  const vague = await handleBridge('raise_question', {
    token,
    domain: 'domain-a',
    ref: 'somewhere',
    text: 'Where?',
  })

  expect(await replied.json()).toEqual({ ok: true, resolved: true })
  expect(await raised.json()).toMatchObject({ ok: true })
  expect(vague.status).toBe(400)
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
    anchorRefs: [{ ref: 'class.Test.property.value', kind: 'schema' }],
    thread: [{ role: 'author', type: 'choice', text: 'Which value?', options: ['A', 'B'] }],
  })
  expect(replies).toEqual([`${awaiting.id}:done`])
  expect(progress).toEqual(['working'])
  expect(notifications).toEqual(['comments:domain-a', 'comments:domain-a'])

  bridge.dispose()
  const expired = await handleBridge('threads', { token })
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
  const bridge = startBridge(workspace(root, [handle]), () => {
    throw new Error('listener failed')
  })
  const configPath = bridge.mcpServers[0]!.args!.at(-1)!
  const { token } = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string }

  const response = await handleBridge('reply', {
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
