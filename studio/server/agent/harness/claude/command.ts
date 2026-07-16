import type { AgentTurnInput, AskInput } from '../adapter'

const PERMISSION_MODE = process.env.DOMAIN_STUDIO_AGENT_PERMISSION || 'bypassPermissions'
const EXTRA_ARGS = (process.env.DOMAIN_STUDIO_CLAUDE_ARGS || '').split(' ').filter(Boolean)

function permissionMode(access?: AgentTurnInput['access']): string {
  return (
    process.env.DOMAIN_STUDIO_AGENT_PERMISSION ||
    (access === 'workspace' ? 'acceptEdits' : PERMISSION_MODE)
  )
}

export function buildClaudeProbeArgs(model?: string): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', ...EXTRA_ARGS]
  if (model) args.push('--model', model)
  return args
}

export function buildClaudeTurnArgs(input: AgentTurnInput, mcpPath?: string): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    permissionMode(input.access),
  ]
  if (input.sessionId) args.push('--resume', input.sessionId)
  if (input.model) args.push('--model', input.model)
  if (input.effort) args.push('--effort', input.effort)
  if (mcpPath) args.push('--mcp-config', mcpPath)
  if (input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt)
  args.push(...EXTRA_ARGS)
  return args
}

export function buildClaudeAskArgs(input: AskInput): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    permissionMode(input.access),
  ]
  if (input.model) args.push('--model', input.model)
  if (input.effort) args.push('--effort', input.effort)
  if (input.sessionId) args.push('--resume', input.sessionId, '--fork-session')
  args.push('--no-session-persistence')
  if (input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt)
  args.push(...EXTRA_ARGS)
  return args
}
