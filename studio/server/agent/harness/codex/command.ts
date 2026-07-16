import type { AgentAccess, AgentEffort } from '../../../../shared/types'
import type { AgentTurnInput } from '../adapter'

import { codexMcpConfigArgs, tomlString } from './mcp'

const EXTRA_ARGS = (process.env.DOMAIN_STUDIO_CODEX_ARGS || '').split(' ').filter(Boolean)

function sandbox(access?: AgentAccess): 'workspace-write' | 'danger-full-access' {
  return access === 'workspace' ? 'workspace-write' : 'danger-full-access'
}

function normalizeEffort(effort?: AgentEffort): AgentEffort | undefined {
  return effort === 'max' ? 'xhigh' : effort
}

/** Build one `codex exec` invocation from the harness-neutral turn. */
export function buildCodexArgs(
  input: Pick<
    AgentTurnInput,
    'appendSystemPrompt' | 'sessionId' | 'model' | 'effort' | 'access' | 'mcpServers'
  >,
  ephemeral = false,
): string[] {
  const args = ['exec']
  if (input.sessionId) args.push('resume', input.sessionId)
  args.push(
    '--json',
    '--skip-git-repo-check',
    '-c',
    'approval_policy="never"',
    '-c',
    `sandbox_mode=${tomlString(sandbox(input.access))}`,
  )
  const effort = normalizeEffort(input.effort)
  if (input.model) args.push('--model', input.model)
  if (effort) args.push('-c', `model_reasoning_effort=${tomlString(effort)}`)
  if (input.appendSystemPrompt)
    args.push('-c', `developer_instructions=${tomlString(input.appendSystemPrompt)}`)
  args.push(...codexMcpConfigArgs(input.mcpServers))
  if (ephemeral) args.push('--ephemeral')
  args.push(...EXTRA_ARGS, '-')
  return args
}
