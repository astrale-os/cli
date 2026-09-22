import type { HarnessCapabilities, HarnessLoadout } from '../../../../shared/types'
import type {
  AgentHarness,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessHealth,
  HarnessLoadoutOptions,
} from '../adapter'
import type { AcpProviderOptions } from './provider'

import { runAcpAsk, runAcpTurn } from './client'
import { acpAgentCommand, type AcpProvider } from './command'
import { probeAcpHealth, probeAcpLoadout } from './probe'

const HEALTH_OK_TTL_MS = 5 * 60_000
const HEALTH_FAILED_TTL_MS = 15_000
const LOADOUT_TTL_MS = 60_000

/**
 * A harness backed exclusively by its bundled ACP agent server. Every provider
 * runs, asks and probes the same way; they differ only in what they are called
 * and what they offer.
 */
export abstract class AcpHarness implements AgentHarness {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly defaultModel: string
  abstract readonly capabilities: HarnessCapabilities

  private healthCache?: { at: number; health: HarnessHealth }
  private healthInFlight?: Promise<HarnessHealth>
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  protected constructor(
    private readonly provider: AcpProvider,
    private readonly bin: string,
    private readonly command?: string[],
  ) {}

  private acpOptions(): AcpProviderOptions {
    return {
      provider: this.provider,
      bin: this.bin,
      command: this.command ?? acpAgentCommand(this.provider),
    }
  }

  async health(signal?: AbortSignal): Promise<HarnessHealth> {
    const now = Date.now()
    const ttl = this.healthCache?.health.ok ? HEALTH_OK_TTL_MS : HEALTH_FAILED_TTL_MS
    if (this.healthCache && now - this.healthCache.at < ttl) return this.healthCache.health
    // Unsignaled probes share one in flight; a signaled one is its caller's to cancel.
    if (!signal && this.healthInFlight) return this.healthInFlight

    const probe = probeAcpHealth(this.acpOptions(), signal).then((health) => {
      if (!signal?.aborted) this.healthCache = { at: Date.now(), health }
      return health
    })
    if (signal) return probe

    this.healthInFlight = probe
    try {
      return await probe
    } finally {
      if (this.healthInFlight === probe) this.healthInFlight = undefined
    }
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    return (await this.health(signal)).ok
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runAcpTurn(this.acpOptions(), input)
  }

  ask(input: AskInput): Promise<AskResult> {
    return runAcpAsk(this.acpOptions(), input)
  }

  async loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    const now = Date.now()
    const key = `${root}\u0000${options?.model ?? ''}\u0000${JSON.stringify(options?.env ?? {})}`
    if (
      !options?.refresh &&
      this.loadoutCache &&
      this.loadoutCache.key === key &&
      now - this.loadoutCache.at < LOADOUT_TTL_MS
    )
      return this.loadoutCache.data
    const data = await probeAcpLoadout(this.acpOptions(), root, options)
    if (!options?.signal?.aborted) this.loadoutCache = { at: now, key, data }
    return data
  }
}
