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

import { runAcpAsk, runAcpTurn } from './client'
import { acpAgentCommand } from './command'
import { probeAcpHealth, probeAcpLoadout } from './probe'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CODEX_BIN || 'codex'

/** Codex harness backed exclusively by its bundled ACP agent server. */
export class AcpCodexHarness implements AgentHarness {
  id = 'codex'
  label = 'Codex'
  defaultModel = 'gpt-5.6-sol'
  capabilities = {
    effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'none',
  } as const

  private healthCache?: { at: number; health: HarnessHealth }
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  constructor(
    private readonly bin = DEFAULT_BIN,
    private readonly command?: string[],
  ) {}

  private acpOptions() {
    return {
      provider: 'codex' as const,
      bin: this.bin,
      command: this.command ?? acpAgentCommand('codex'),
    }
  }

  async health(signal?: AbortSignal): Promise<HarnessHealth> {
    const now = Date.now()
    if (this.healthCache && now - this.healthCache.at < 30_000) return this.healthCache.health
    const health = await probeAcpHealth(this.acpOptions(), signal)
    if (!signal?.aborted) this.healthCache = { at: now, health }
    return health
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    return (await this.health(signal)).ok
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runAcpTurn(
      {
        ...this.acpOptions(),
      },
      input,
    )
  }

  ask(input: AskInput): Promise<AskResult> {
    return runAcpAsk(
      {
        ...this.acpOptions(),
      },
      input,
    )
  }

  async loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    const now = Date.now()
    const key = `${root}\u0000${options?.model ?? ''}\u0000${JSON.stringify(options?.env ?? {})}`
    if (
      !options?.refresh &&
      this.loadoutCache &&
      this.loadoutCache.key === key &&
      now - this.loadoutCache.at < 60_000
    )
      return this.loadoutCache.data
    const data = await probeAcpLoadout(this.acpOptions(), root, options)
    if (!options?.signal?.aborted) this.loadoutCache = { at: now, key, data }
    return data
  }
}
