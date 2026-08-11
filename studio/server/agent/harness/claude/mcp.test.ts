import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeClaudeMcpConfig } from './mcp'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('serializes a structured MCP grant into Claude JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-mcp-'))
  roots.push(root)
  const config = writeClaudeMcpConfig(root, [
    {
      name: 'domain-studio',
      command: '/opt/bun',
      args: ['/studio/bridge/stdio.ts', '--config', '/domain/bridge.json'],
      env: { MODE: 'test value' },
    },
  ])
  expect(JSON.parse(readFileSync(config.path!, 'utf8'))).toEqual({
    mcpServers: {
      'domain-studio': {
        command: '/opt/bun',
        args: ['/studio/bridge/stdio.ts', '--config', '/domain/bridge.json'],
        env: { MODE: 'test value' },
      },
    },
  })
  config.dispose()
  expect(existsSync(config.path!)).toBe(false)
})
