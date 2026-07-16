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

import { captureCommand } from '../process'
import { readSkillContent } from '../skills'
import { runCodexForkAsk } from './ask'
import { CODEX_CAPABILITIES } from './capabilities'
import { runCodexExec } from './exec'
import { loadCodexConfiguration } from './loadout'
import { scanCodexSkills } from './skills'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CODEX_BIN || 'codex'

export class CodexHarness implements AgentHarness {
  id = 'codex'
  label = 'Codex (local)'
  capabilities = CODEX_CAPABILITIES

  private availCache?: { at: number; health: HarnessHealth }
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  constructor(private readonly bin = DEFAULT_BIN) {}

  async health(signal?: AbortSignal): Promise<HarnessHealth> {
    const now = Date.now()
    if (this.availCache && now - this.availCache.at < 30_000) return this.availCache.health
    const result = await captureCommand(this.bin, ['--version'], process.cwd(), { signal })
    const health: HarnessHealth = {
      ok: result.code === 0,
      version: result.code === 0 ? result.stdout.trim() || undefined : undefined,
      bin: this.bin,
      detail:
        result.code === 0
          ? undefined
          : result.stderr.trim() ||
            `\`${this.bin}\` was not found on PATH; install it and run \`codex login\``,
    }
    if (!signal?.aborted) this.availCache = { at: now, health }
    return health
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    return (await this.health(signal)).ok
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runCodexExec(this.bin, input)
  }

  async ask(input: AskInput): Promise<AskResult> {
    let result = await runCodexForkAsk(this.bin, input)
    if (result.isError && result.text) return result
    if (result.isError && result.errorMessage !== 'canceled' && input.sessionId)
      result = await runCodexForkAsk(this.bin, { ...input, sessionId: undefined })
    if (!result.isError || result.errorMessage === 'canceled') return result
    if (result.text) return result

    let streamed = ''
    const fallback = await runCodexExec(
      this.bin,
      {
        ...input,
        sessionId: undefined,
        mcpServers: [],
        onEvent: (event) => {
          if (event.kind === 'message') {
            streamed = event.text
            input.onDelta(event.text)
          }
        },
      },
      true,
    )
    return {
      text: fallback.finalText || streamed,
      isError: fallback.isError,
      errorMessage: fallback.errorMessage,
    }
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
    const data = await loadCodexConfiguration(this.bin, root, options)
    this.loadoutCache = { at: now, key, data }
    return data
  }

  async skillContent(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null> {
    const loadout = await this.loadout(root)
    return readSkillContent(loadout.skills, command)
  }
}
