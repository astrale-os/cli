import * as acp from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'

import type { HarnessLoadout } from '../../../../shared/types'
import type { HarnessHealth, HarnessLoadoutOptions } from '../adapter'
import type { AcpProviderOptions } from './provider'

import { isAgentEffort } from '../../../../shared/agent-effort'
import { childEnvironment, terminateProcessTree } from '../process'
import { effortConfig, effortOptions, modelConfig, modelOptions } from './options'
import { providerEnvironment, providerSessionMeta } from './provider'

const PROBE_TIMEOUT_MS = 30_000
const CLEANUP_TIMEOUT_MS = 5_000
const MAX_STDERR = 16_000

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

interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
  spawnError?: string
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
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(options.command[0], options.command.slice(1), {
      cwd: input.root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(env),
      detached: process.platform !== 'win32',
    })
  } catch (error) {
    throw new Error(`failed to spawn ${options.provider} ACP agent: ${errorText(error)}`)
  }

  let stderr = ''
  let exited = false
  let resolveExit!: (exit: ProcessExit) => void
  const exit = new Promise<ProcessExit>((resolve) => {
    resolveExit = resolve
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_STDERR)
  })
  child.once('error', (error) => {
    if (exited) return
    exited = true
    resolveExit({ code: null, signal: null, spawnError: error.message })
  })
  child.once('close', (code, signal) => {
    if (exited) return
    exited = true
    resolveExit({ code, signal })
  })

  const processFailure = (result: ProcessExit): Error =>
    new Error(
      result.spawnError
        ? `failed to spawn ${options.provider} ACP agent: ${result.spawnError}`
        : `${options.provider} ACP agent exited ${result.code ?? result.signal ?? -1}${stderrSuffix(stderr)}`,
    )

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
    try {
      return await Promise.race([
        promise,
        exit.then((result) => Promise.reject(processFailure(result))),
        timeout,
        ...(aborted ? [aborted] : []),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const stopChild = async () => {
    try {
      child.stdin?.end()
    } catch {
      /* already closed */
    }
    if (exited) return
    await Promise.race([
      exit.then(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ])
    if (exited) return
    terminateProcessTree(child)
    await Promise.race([
      exit.then(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 750)),
    ])
    if (!exited) terminateProcessTree(child, 'SIGKILL')
  }

  let connection: acp.ClientConnection | undefined
  let context: acp.ClientContext | undefined
  let initialized: acp.InitializeResponse | undefined
  let sessionId: string | undefined
  try {
    const output = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>
    const source = Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>
    const app = acp
      .client({ name: 'astrale-domain-studio-probe' })
      .onRequest(acp.methods.client.session.requestPermission, () => ({
        outcome: { outcome: 'cancelled' },
      }))
      .onNotification(acp.methods.client.session.update, () => {})
    connection = app.connect(acp.ndJsonStream(output, source))
    context = connection.agent

    const response = await withProcess<acp.InitializeResponse>(
      context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
        clientInfo: {
          name: 'astrale-domain-studio-probe',
          title: 'Astrale Domain Studio Probe',
        },
      }) as Promise<acp.InitializeResponse>,
      'initialize',
    )
    initialized = response
    if (response.protocolVersion !== acp.PROTOCOL_VERSION)
      throw new Error(
        `${options.provider} ACP negotiated unsupported protocol version ${response.protocolVersion}`,
      )

    if (!input.createSession)
      return { initialized: response, nativeConfigOptions: [], configOptions: [] }

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
    return { initialized: response, nativeConfigOptions, configOptions }
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
    await stopChild()
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
