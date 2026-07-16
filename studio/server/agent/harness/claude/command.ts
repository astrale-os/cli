import type { AgentTurnInput, AskInput } from '../adapter'

const PERMISSION_MODE = process.env.DOMAIN_STUDIO_AGENT_PERMISSION || 'bypassPermissions'
const EXTRA_ARGS = (process.env.DOMAIN_STUDIO_CLAUDE_ARGS || '').split(' ').filter(Boolean)
const ULTRACODE_SETTINGS = JSON.stringify({ ultracode: true })

function permissionMode(access?: AgentTurnInput['access']): string {
  return (
    process.env.DOMAIN_STUDIO_AGENT_PERMISSION ||
    (access === 'workspace' ? 'acceptEdits' : PERMISSION_MODE)
  )
}

function appendEffort(args: string[], effort?: AgentTurnInput['effort']): void {
  if (!effort) return
  if (effort === 'ultracode') {
    args.push('--effort', 'xhigh', '--settings', ULTRACODE_SETTINGS)
    return
  }
  args.push('--effort', effort)
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
  appendEffort(args, input.effort)
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
  appendEffort(args, input.effort)
  if (input.sessionId) args.push('--resume', input.sessionId, '--fork-session')
  args.push('--no-session-persistence')
  if (input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt)
  args.push(...EXTRA_ARGS)
  return args
}
