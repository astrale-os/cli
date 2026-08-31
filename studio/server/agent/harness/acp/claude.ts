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

import { ClaudeCodeHarness } from '../claude/adapter'
import { CLAUDE_CAPABILITIES } from '../claude/capabilities'
import { runAcpAsk, runAcpTurn } from './client'
import { acpAgentCommand } from './command'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CLAUDE_BIN || 'claude'

/** Active Claude Code harness. The legacy stream-json adapter remains in ../claude. */
export class AcpClaudeHarness implements AgentHarness {
  id = 'claude'
  label = 'Claude Code (local)'
  capabilities = CLAUDE_CAPABILITIES

  private readonly legacy: ClaudeCodeHarness

  constructor(
    private readonly bin = DEFAULT_BIN,
    private readonly command?: string[],
  ) {
    this.legacy = new ClaudeCodeHarness(bin)
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
        provider: 'claude',
        bin: this.bin,
        command: this.command ?? acpAgentCommand('claude'),
      },
      input,
    )
  }

  ask(input: AskInput): Promise<AskResult> {
    return runAcpAsk(
      {
        provider: 'claude',
        bin: this.bin,
        command: this.command ?? acpAgentCommand('claude'),
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
