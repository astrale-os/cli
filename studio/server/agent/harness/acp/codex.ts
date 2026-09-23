import { AcpHarness } from './harness'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CODEX_BIN || 'codex'

/** Codex harness backed exclusively by its bundled ACP agent server. */
export class AcpCodexHarness extends AcpHarness {
  id = 'codex'
  label = 'Codex'
  defaultModel = 'gpt-5.6-sol'
  capabilities = {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'none',
  } as const

  constructor(bin = DEFAULT_BIN, command?: string[]) {
    super('codex', bin, command)
  }
}
