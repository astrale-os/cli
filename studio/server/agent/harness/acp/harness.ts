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

import { agentBinary, describeAgentBinary, ensureAgentBinary, type AgentBinary } from './binary'
import { runAcpAsk, runAcpTurn } from './client'
import { acpAgentCommand, type AcpProvider } from './command'
import { probeAcpHealth, probeAcpLoadout } from './probe'

const HEALTH_OK_TTL_MS = 5 * 60_000
const HEALTH_FAILED_TTL_MS = 15_000
const LOADOUT_TTL_MS = 60_000

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

/**
 * A harness backed exclusively by its bundled ACP agent server. Every provider
 * runs, asks and probes the same way; they differ only in what they are called
 * and what they offer.
 *
 * The agent CLI behind the server is the build Studio pins (`binary.ts`),
 * installed the first time a turn, an ask or a loadout probe needs it — never by
 * a health read, which only says whether it is there yet.
 */
export abstract class AcpHarness implements AgentHarness {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly defaultModel: string
  abstract readonly capabilities: HarnessCapabilities

  private healthCache?: { at: number; health: HarnessHealth }
  private healthInFlight?: Promise<HarnessHealth>
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  /** `bin` pins the executable, bypassing both the environment and Studio's own build. */
  protected constructor(
    private readonly provider: AcpProvider,
    private readonly bin?: string,
    private readonly command?: string[],
  ) {}

  /** Resolved on every call, so an environment override applies without a restart. */
  private binary(): AgentBinary {
    return agentBinary(this.provider, this.bin)
  }

  private acpOptions(binary: AgentBinary): AcpProviderOptions {
    return {
      provider: this.provider,
      bin: binary.path,
      managed: binary.source === 'managed',
      command: this.command ?? acpAgentCommand(this.provider),
    }
  }

  /** Install the managed build if it is missing; a health read that said so is stale after. */
  private async ensure(
    binary: AgentBinary,
    signal?: AbortSignal,
    onProgress?: (text: string) => void,
  ): Promise<void> {
    await ensureAgentBinary(binary, { signal, onProgress })
    if (this.healthCache?.health.cli?.installed === false) this.healthCache = undefined
  }

  private async probeHealth(signal?: AbortSignal): Promise<HarnessHealth> {
    const binary = this.binary()
    const cli = await describeAgentBinary(binary)
    if (!cli.installed)
      return {
        ok: true,
        bin: binary.path,
        cli,
        detail: `${binary.label} ${binary.pinnedVersion} is installed by Studio on first use.`,
      }

    const health = await probeAcpHealth(this.acpOptions(binary), signal)
    const origin =
      cli.source === 'managed'
        ? `${binary.label} ${binary.pinnedVersion}, pinned by Studio`
        : `Local ${binary.path}${cli.version ? ` ${cli.version}` : ''} (${cli.reason})`
    // the warning leads: it is what someone opening Settings needs, and the row clamps
    const detail = [cli.warning, origin, health.detail].filter(Boolean).join(' · ')
    return { ...health, cli, detail }
  }

  async health(signal?: AbortSignal): Promise<HarnessHealth> {
    const now = Date.now()
    const ttl = this.healthCache?.health.ok ? HEALTH_OK_TTL_MS : HEALTH_FAILED_TTL_MS
    if (this.healthCache && now - this.healthCache.at < ttl) return this.healthCache.health
    // Unsignaled probes share one in flight; a signaled one is its caller's to cancel.
    if (!signal && this.healthInFlight) return this.healthInFlight

    const probe = this.probeHealth(signal).then((health) => {
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

  async run(input: AgentTurnInput): Promise<AgentTurnResult> {
    const binary = this.binary()
    try {
      await this.ensure(binary, input.signal, (text) => input.onEvent({ kind: 'status', text }))
    } catch (error) {
      return {
        sessionId: input.sessionId,
        finalText: '',
        isError: true,
        errorMessage: input.signal.aborted ? 'canceled' : errorText(error),
      }
    }
    return runAcpTurn(this.acpOptions(binary), input)
  }

  async ask(input: AskInput): Promise<AskResult> {
    const binary = this.binary()
    try {
      await this.ensure(binary, input.signal)
    } catch (error) {
      return {
        text: '',
        isError: true,
        errorMessage: input.signal.aborted ? 'canceled' : errorText(error),
      }
    }
    return runAcpAsk(this.acpOptions(binary), input)
  }

  async loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    const now = Date.now()
    const binary = this.binary()
    const key = `${root}\u0000${binary.path}\u0000${options?.model ?? ''}\u0000${JSON.stringify(options?.env ?? {})}`
    if (
      !options?.refresh &&
      this.loadoutCache &&
      this.loadoutCache.key === key &&
      now - this.loadoutCache.at < LOADOUT_TTL_MS
    )
      return this.loadoutCache.data
    try {
      await this.ensure(binary, options?.signal)
    } catch (error) {
      return { ok: false, detail: errorText(error), cwd: root, probedAt: now, source: 'acp' }
    }
    const data = await probeAcpLoadout(this.acpOptions(binary), root, options)
    if (!options?.signal?.aborted) this.loadoutCache = { at: now, key, data }
    return data
  }
}
