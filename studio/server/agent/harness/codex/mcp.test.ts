import { expect, test } from 'bun:test'

import { codexMcpConfigArgs } from './mcp'

test('serializes a structured MCP grant into Codex overrides', () => {
  expect(
    codexMcpConfigArgs([
      {
        name: 'domain-studio',
        command: '/opt/bun',
        args: ['/studio/bridge/stdio.ts', '--config', '/domain/bridge.json'],
        env: { MODE: 'test value' },
        required: true,
        approvalMode: 'approve',
        enabledTools: ['reply_to_thread', 'resolve_thread'],
      },
    ]),
  ).toEqual([
    '-c',
    'mcp_servers.domain-studio.command="/opt/bun"',
    '-c',
    'mcp_servers.domain-studio.args=["/studio/bridge/stdio.ts","--config","/domain/bridge.json"]',
    '-c',
    'mcp_servers.domain-studio.env={MODE="test value"}',
    '-c',
    'mcp_servers.domain-studio.required=true',
    '-c',
    'mcp_servers.domain-studio.default_tools_approval_mode="approve"',
    '-c',
    'mcp_servers.domain-studio.enabled_tools=["reply_to_thread","resolve_thread"]',
  ])
})
