import { describe, expect, test } from 'bun:test'

import { buildCodexArgs } from './command'

describe('Codex command construction', () => {
  test('builds a new stable JSONL turn with developer instructions and approved MCP tools', () => {
    const args = buildCodexArgs({
      appendSystemPrompt: 'Studio protocol\nwith a newline',
      model: 'gpt-studio',
      effort: 'high',
      access: 'workspace',
      mcpServers: [
        {
          name: 'domain-studio',
          command: '/opt/homebrew/bin/bun',
          args: ['/studio/bridge/stdio.ts', '--config', '/domain/.domain-studio/bridge.json'],
          required: true,
          approvalMode: 'approve',
          enabledTools: ['reply_to_thread'],
        },
      ],
    })
    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-c',
      'approval_policy="never"',
      '-c',
      'sandbox_mode="workspace-write"',
      '--model',
      'gpt-studio',
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'developer_instructions="Studio protocol\\nwith a newline"',
      '-c',
      'mcp_servers.domain-studio.command="/opt/homebrew/bin/bun"',
      '-c',
      'mcp_servers.domain-studio.args=["/studio/bridge/stdio.ts","--config","/domain/.domain-studio/bridge.json"]',
      '-c',
      'mcp_servers.domain-studio.required=true',
      '-c',
      'mcp_servers.domain-studio.default_tools_approval_mode="approve"',
      '-c',
      'mcp_servers.domain-studio.enabled_tools=["reply_to_thread"]',
      '-',
    ])
  })

  test('resumes by thread id, maps Claude-only effort modes, and can be ephemeral', () => {
    const args = buildCodexArgs(
      {
        sessionId: '019f-thread',
        effort: 'max',
        access: 'full',
      },
      true,
    )
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', '019f-thread'])
    expect(args.join(' ')).toContain('model_reasoning_effort="xhigh"')
    expect(args.join(' ')).toContain('sandbox_mode="danger-full-access"')
    expect(args).toContain('--ephemeral')

    expect(buildCodexArgs({ effort: 'ultracode' }).join(' ')).toContain(
      'model_reasoning_effort="xhigh"',
    )
  })
})
