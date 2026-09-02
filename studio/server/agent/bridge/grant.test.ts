import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../../domain'
import type { AgentWorkspace } from '../workspace'

import { startBridge } from './grant'

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

function workspace(root: string, handle: DomainHandle): AgentWorkspace {
  return {
    root,
    stateRoot: join(root, 'machine-agent'),
    uiRoot: join(root, 'machine-ui'),
    key: idFor(root),
    domains: [handle],
  }
}

function idFor(root: string): string {
  return root.split('/').at(-1) ?? 'workspace'
}

test('keeps its bearer out of the harness command line', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-bridge-'))
  roots.push(root)

  const bridge = startBridge(workspace(root, domain(root, 'test-domain')), () => {})
  const server = bridge.mcpServers[0]!
  const configPath = server.args?.at(-1)
  expect(server.name).toBe('domain-studio')
  expect(server.approvalMode).toBe('approve')
  expect(configPath).toBeTruthy()

  const config = JSON.parse(readFileSync(configPath!, 'utf8')) as {
    base: string
    token: string
  }
  expect(server.args?.join(' ')).not.toContain(config.token)
  expect(config.base).toContain('/api/agent/bridge')
  expect(existsSync(configPath!)).toBe(true)
  expect(statSync(configPath!).mode & 0o777).toBe(0o600)

  bridge.dispose()
  expect(existsSync(configPath!)).toBe(false)
})

test('does not let an in-process tool replace its scoped bearer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-bridge-invoke-'))
  roots.push(root)
  const bridge = startBridge(workspace(root, domain(root, 'test-domain')), () => {})
  const server = bridge.mcpServers[0]!

  await expect(server.invoke?.('list_open_threads', { token: 'forged' })).resolves.toEqual({
    threads: [],
  })
  bridge.dispose()
})
