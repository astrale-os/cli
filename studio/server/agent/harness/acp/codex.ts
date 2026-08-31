import type { HarnessLoadout } from '../../../../shared/types'
import type {
  AgentHarness,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessHealth,
  HarnessLoadoutOptions,
} from '../adapter'

import { CodexHarness } from '../codex/adapter'
import { runAcpAsk, runAcpTurn } from './client'
import { acpAgentCommand } from './command'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CODEX_BIN || 'codex'

/** Active Codex harness. The legacy native-JSON adapter remains in ../codex. */
export class AcpCodexHarness implements AgentHarness {
  id = 'codex'
  label = 'Codex (local)'
  capabilities = {
    effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'none',
  } as const

  private readonly legacy: CodexHarness

  constructor(
    private readonly bin = DEFAULT_BIN,
    private readonly command?: string[],
  ) {
    this.legacy = new CodexHarness(bin)
  }

  health(signal?: AbortSignal): Promise<HarnessHealth> {
    return this.legacy.health(signal)
  }

  isAvailable(signal?: AbortSignal): Promise<boolean> {
    return this.legacy.isAvailable(signal)
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runAcpTurn(
      {
        provider: 'codex',
        bin: this.bin,
        command: this.command ?? acpAgentCommand('codex'),
      },
      input,
    )
  }

  ask(input: AskInput): Promise<AskResult> {
    return runAcpAsk(
      {
        provider: 'codex',
        bin: this.bin,
        command: this.command ?? acpAgentCommand('codex'),
      },
      input,
    )
  }

  loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    return this.legacy.loadout(root, options)
  }

  skillContent(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null> {
    return this.legacy.skillContent(root, command)
  }
}
