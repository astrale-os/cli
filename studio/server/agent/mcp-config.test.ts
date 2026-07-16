import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { codexMcpConfigArgs, writeClaudeMcpConfig } from './mcp-config'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const server = {
  name: 'domain-studio',
  command: '/opt/bun',
  args: ['/studio/bridge-mcp.ts', '--config', '/domain/bridge.json'],
  env: { MODE: 'test value' },
  required: true,
  approvalMode: 'approve' as const,
  enabledTools: ['reply_to_thread', 'resolve_thread'],
}

test('serializes the same structured MCP server for Claude and Codex', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-mcp-config-'))
  roots.push(root)
  const claude = writeClaudeMcpConfig(root, [server])
  expect(JSON.parse(readFileSync(claude.path!, 'utf8'))).toEqual({
    mcpServers: {
      'domain-studio': {
        command: '/opt/bun',
        args: ['/studio/bridge-mcp.ts', '--config', '/domain/bridge.json'],
        env: { MODE: 'test value' },
      },
    },
  })

  expect(codexMcpConfigArgs([server])).toEqual([
    '-c',
    'mcp_servers.domain-studio.command="/opt/bun"',
    '-c',
    'mcp_servers.domain-studio.args=["/studio/bridge-mcp.ts","--config","/domain/bridge.json"]',
    '-c',
    'mcp_servers.domain-studio.env={MODE="test value"}',
    '-c',
    'mcp_servers.domain-studio.required=true',
    '-c',
    'mcp_servers.domain-studio.default_tools_approval_mode="approve"',
    '-c',
    'mcp_servers.domain-studio.enabled_tools=["reply_to_thread","resolve_thread"]',
  ])

  claude.dispose()
  expect(existsSync(claude.path!)).toBe(false)
})
