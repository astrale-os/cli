import type { HarnessLoadout } from '../../../../shared/types'
import type {
  AgentHarness,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  HarnessHealth,
  HarnessLoadoutOptions,
} from '../adapter'

import { readSkillContent } from '../skills'
import { runClaudeAsk } from './ask'
import { runClaudeTurn } from './events'
import { loadClaudeConfiguration, probeClaudeHealth } from './loadout'
import { scanClaudeSkills } from './skills'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CLAUDE_BIN || 'claude'

export class ClaudeCodeHarness implements AgentHarness {
  id = 'claude'
  label = 'Claude Code (local)'
  capabilities = {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  } as const

  private availCache?: { at: number; health: HarnessHealth }
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  constructor(private readonly bin = DEFAULT_BIN) {}

  async health(signal?: AbortSignal): Promise<HarnessHealth> {
    const now = Date.now()
    if (this.availCache && now - this.availCache.at < 30_000) return this.availCache.health
    const health = await probeClaudeHealth(this.bin, signal)
    if (!signal?.aborted) this.availCache = { at: now, health }
    return health
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    return (await this.health(signal)).ok
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
    const data = await loadClaudeConfiguration(this.bin, root, options)
    this.loadoutCache = { at: now, key, data }
    return data
  }

  async skillContent(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null> {
    return readSkillContent(scanClaudeSkills(root), command)
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runClaudeTurn(this.bin, input)
  }

  ask(input: AskInput) {
    return runClaudeAsk(this.bin, input)
  }
}
