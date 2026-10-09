import * as acp from '@agentclientprotocol/sdk'

import type { HarnessLoadout } from '../../../../shared/types'
import type { HarnessHealth, HarnessLoadoutOptions } from '../adapter'
import type { ProcessExit } from './agent-process'
import type { AcpProviderOptions } from './provider'

import { isAgentEffort } from '../../../../shared/agent-effort'
import { terminateProcessTree } from '../process'
import { initializeAgent, spawnAcpAgent } from './agent-process'
import {
  effortConfig,
  effortOptions,
  fastConfig,
  fastEnabled,
  modelConfig,
  modelOptions,
} from './options'
import { providerEnvironment, providerSessionMeta } from './provider'

const PROBE_TIMEOUT_MS = 30_000
/** How long a failed request waits for the process to say what went wrong. */
const EXIT_GRACE_MS = 250
const CLEANUP_TIMEOUT_MS = 5_000

interface AcpProbeSnapshot {
  initialized: acp.InitializeResponse
  nativeConfigOptions: acp.SessionConfigOption[]
  configOptions: acp.SessionConfigOption[]
}

interface AcpProbeInput {
  root: string
  env?: Record<string, string>
  model?: string
  signal?: AbortSignal
  createSession: boolean
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function stderrSuffix(stderr: string): string {
  const text = stderr.trim()
  return text ? `: ${text.slice(-800)}` : ''
}

async function runAcpProbe(
  options: AcpProviderOptions,
  input: AcpProbeInput,
): Promise<AcpProbeSnapshot> {
  if (input.signal?.aborted) throw new Error('canceled')

  const env = providerEnvironment(options, { env: input.env })
  let agent: ReturnType<typeof spawnAcpAgent>
  try {
    agent = spawnAcpAgent(options.provider, options.command, input.root, env)
  } catch (error) {
    throw new Error(`failed to spawn ${options.provider} ACP agent: ${errorText(error)}`)
  }
  const { child, exit } = agent
  const processFailure = (result: ProcessExit) => agent.failure(result, stderrSuffix)

  let rejectAbort: ((error: Error) => void) | undefined
  const aborted = input.signal
    ? new Promise<never>((_, reject) => {
        rejectAbort = reject
      })
    : undefined
  const onAbort = () => {
    terminateProcessTree(child, 'SIGKILL')
    rejectAbort?.(new Error('canceled'))
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })

  const withProcess = async <T>(
    promise: Promise<T>,
    label: string,
    timeoutMs = PROBE_TIMEOUT_MS,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${options.provider} ACP ${label} timed out`)),
        timeoutMs,
      )
      timer.unref?.()
    })
    // An agent that dies on startup closes the stream before Node reports the
    // exit, so the SDK gets there first with "ACP connection closed" — which is
    // the one thing nobody needs to be told. Give the process the last word when
    // it is on its way out: its exit code and its stderr are the whole of the
    // answer to "why can I not connect?", and that answer is now on screen.
    const explained = promise.catch(async (error: unknown) => {
      let settle: ReturnType<typeof setTimeout> | undefined
      const grace = new Promise<null>((resolve) => {
        settle = setTimeout(() => resolve(null), EXIT_GRACE_MS)
        settle.unref?.()
      })
      try {
        const result = await Promise.race([exit, grace])
        throw result ? processFailure(result) : error
      } finally {
        if (settle) clearTimeout(settle)
      }
    })
    try {
      return await Promise.race([
        explained,
        exit.then((result) => Promise.reject(processFailure(result))),
        timeout,
        ...(aborted ? [aborted] : []),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  let connection: acp.ClientConnection | undefined
  let context: acp.ClientContext | undefined
  let initialized: acp.InitializeResponse | undefined
  let sessionId: string | undefined
  try {
    const app = acp
      .client({ name: 'astrale-domain-studio-probe' })
      .onRequest(acp.methods.client.session.requestPermission, () => ({
        outcome: { outcome: 'cancelled' },
      }))
      .onNotification(acp.methods.client.session.update, () => {})
    connection = app.connect(agent.stream())
    context = connection.agent

    initialized = await initializeAgent(
      context,
      options.provider,
      { name: 'astrale-domain-studio-probe', title: 'Astrale Domain Studio Probe' },
      withProcess,
    )
    if (!input.createSession) return { initialized, nativeConfigOptions: [], configOptions: [] }

    const meta = providerSessionMeta(options.provider, { env: input.env })
    const setup = await withProcess(
      context.request(acp.methods.agent.session.new, {
        cwd: input.root,
        mcpServers: [],
        ...(meta ? { _meta: meta } : {}),
      }),
      'session creation',
    )
    sessionId = setup.sessionId
    const nativeConfigOptions = setup.configOptions ?? []
    let configOptions = nativeConfigOptions
    if (input.model) {
      const config = modelConfig(configOptions)
      if (!config)
        throw new Error(`${options.provider} ACP agent did not expose its model selector`)
      const selected = await withProcess(
        context.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: config.id,
          value: input.model,
        }),
        'model selection',
      )
      configOptions = selected.configOptions
    }
    return { initialized, nativeConfigOptions, configOptions }
  } finally {
    const capabilities = initialized?.agentCapabilities?.sessionCapabilities
    if (sessionId && context && !input.signal?.aborted) {
      if (capabilities?.delete)
        await withProcess(
          context.request(acp.methods.agent.session.delete, { sessionId }),
          'session deletion',
          CLEANUP_TIMEOUT_MS,
        ).catch(() => {})
      else if (capabilities?.close)
        await withProcess(
          context.request(acp.methods.agent.session.close, { sessionId }),
          'session close',
          CLEANUP_TIMEOUT_MS,
        ).catch(() => {})
    }
    input.signal?.removeEventListener('abort', onAbort)
    try {
      connection?.close()
    } catch {
      /* already closed */
    }
    await agent.shutdown(250, 750)
  }
}

export async function probeAcpHealth(
  options: AcpProviderOptions,
  signal?: AbortSignal,
): Promise<HarnessHealth> {
  try {
    const { initialized } = await runAcpProbe(options, {
      root: process.cwd(),
      signal,
      createSession: false,
    })
    return {
      ok: true,
      bin: options.bin,
      version: initialized.agentInfo?.version ?? undefined,
      detail: `${initialized.agentInfo?.title ?? initialized.agentInfo?.name ?? options.provider} initialized over ACP v${initialized.protocolVersion}`,
    }
  } catch (error) {
    return {
      ok: false,
      bin: options.bin,
      detail: errorText(error),
    }
  }
}

export async function probeAcpLoadout(
  options: AcpProviderOptions,
  root: string,
  probeOptions?: HarnessLoadoutOptions,
): Promise<HarnessLoadout> {
  const probedAt = Date.now()
  try {
    const snapshot = await runAcpProbe(options, {
      root,
      env: probeOptions?.env,
      model: probeOptions?.model,
      signal: probeOptions?.signal,
      createSession: true,
    })
    const nativeConfig = modelConfig(snapshot.nativeConfigOptions)
    const effectiveConfig = modelConfig(snapshot.configOptions)
    const nativeModel = nativeConfig?.currentValue
    const model = effectiveConfig?.currentValue ?? probeOptions?.model ?? nativeModel
    // Read the ladder AFTER the model override: it is the selected model that
    // decides which levels exist, and whether there are any at all.
    const effort = effortConfig(snapshot.configOptions)
    const fast = fastConfig(snapshot.configOptions)
    const efforts = effortOptions(options.provider, effort)
    const nativeEffort = effortConfig(snapshot.nativeConfigOptions)?.currentValue
    const implementation = snapshot.initialized.agentInfo
    const agentName = implementation?.title ?? implementation?.name
    return {
      ok: true,
      detail: `${agentName ?? options.provider} initialized a disposable ACP session${model ? ` with ${model}` : ''}.`,
      nativeModel,
      model,
      modelSource: probeOptions?.model ? 'studio' : 'agent',
      models: modelOptions(nativeConfig),
      ...(isAgentEffort(effort?.currentValue) ? { effort: effort.currentValue } : {}),
      ...(isAgentEffort(nativeEffort) ? { nativeEffort } : {}),
      ...(efforts === undefined ? {} : { efforts }),
      ...(fast
        ? {
            fastMode: {
              enabled: fastEnabled(fast),
              ...(fast.description ? { description: fast.description } : {}),
            },
          }
        : {}),
      cwd: root,
      protocolVersion: snapshot.initialized.protocolVersion,
      agentName,
      agentVersion: implementation?.version ?? undefined,
      probedAt,
      source: 'acp',
    }
  } catch (error) {
    return {
      ok: false,
      detail: errorText(error),
      cwd: root,
      probedAt,
      source: 'acp',
    }
  }
}
