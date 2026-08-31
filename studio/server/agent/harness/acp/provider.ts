import type { AgentAccess, AgentEffort } from '../../../../shared/types'
import type { AgentTurnInput, AskInput } from '../adapter'
import type { AcpProvider } from './command'

export interface AcpProviderOptions {
  provider: AcpProvider
  bin: string
  command: string[]
}

type AcpInput = Pick<AgentTurnInput | AskInput, 'access' | 'appendSystemPrompt' | 'effort' | 'env'>

function parseObject(value: string | undefined, name: string): Record<string, unknown> {
  if (!value) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${name} must contain a JSON object`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${name} must contain a JSON object`)
  return parsed as Record<string, unknown>
}

function claudeExtraArgs(raw: string | undefined): Record<string, string> {
  const tokens = (raw ?? '').split(' ').filter(Boolean)
  const args: Record<string, string> = {}
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = tokens[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index++
    } else args[key] = ''
  }
  return args
}

function codexEffort(effort: AgentEffort): string {
  return effort === 'max' || effort === 'ultracode' ? 'xhigh' : effort
}

function claudeEffort(effort: AgentEffort): string {
  return effort === 'ultracode' ? 'xhigh' : effort
}

export function providerEffort(provider: AcpProvider, effort: AgentEffort): string {
  return provider === 'codex' ? codexEffort(effort) : claudeEffort(effort)
}

export function providerEffortConfigId(provider: AcpProvider): string {
  return provider === 'codex' ? 'reasoning_effort' : 'effort'
}

export function providerMode(provider: AcpProvider, access: AgentAccess | undefined): string {
  if (provider === 'codex') return access === 'workspace' ? 'agent' : 'agent-full-access'
  return (
    process.env.DOMAIN_STUDIO_AGENT_PERMISSION ||
    (access === 'workspace' ? 'acceptEdits' : 'bypassPermissions')
  )
}

export function providerEnvironment(
  options: AcpProviderOptions,
  input: AcpInput,
): Record<string, string> {
  const env = { ...(input.env ?? {}) }
  if (options.provider === 'claude') {
    env.CLAUDE_CODE_EXECUTABLE = options.bin
    return env
  }

  env.CODEX_PATH = options.bin
  env.INITIAL_AGENT_MODE = providerMode('codex', input.access)
  const configSource = input.env?.CODEX_CONFIG ?? process.env.CODEX_CONFIG
  const config = parseObject(configSource, 'CODEX_CONFIG')
  if (input.appendSystemPrompt) {
    const existing =
      typeof config.developer_instructions === 'string' ? config.developer_instructions.trim() : ''
    config.developer_instructions = [existing, input.appendSystemPrompt.trim()]
      .filter(Boolean)
      .join('\n\n')
  }
  if (Object.keys(config).length) env.CODEX_CONFIG = JSON.stringify(config)
  return env
}

/** Provider-specific ACP extension metadata used when materializing a session. */
export function providerSessionMeta(
  provider: AcpProvider,
  input: AcpInput,
): Record<string, unknown> | undefined {
  if (provider !== 'claude') return undefined

  const meta: Record<string, unknown> = {}
  if (input.appendSystemPrompt)
    meta.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: input.appendSystemPrompt,
    }

  const extraArgs = claudeExtraArgs(
    input.env?.DOMAIN_STUDIO_CLAUDE_ARGS ?? process.env.DOMAIN_STUDIO_CLAUDE_ARGS,
  )
  if (input.effort === 'ultracode') extraArgs.settings = JSON.stringify({ ultracode: true })
  if (Object.keys(extraArgs).length)
    meta.claudeCode = {
      options: { extraArgs },
    }

  return Object.keys(meta).length ? meta : undefined
}
