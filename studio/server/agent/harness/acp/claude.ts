import { AcpHarness } from './harness'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CLAUDE_BIN || 'claude'

/** Claude Code harness backed exclusively by its bundled ACP agent server. */
export class AcpClaudeHarness extends AcpHarness {
  id = 'claude'
  label = 'Claude Code'
  defaultModel = 'opus[1m]'
  capabilities = {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  } as const

  constructor(bin = DEFAULT_BIN, command?: string[]) {
    super('claude', bin, command)
  }
}
