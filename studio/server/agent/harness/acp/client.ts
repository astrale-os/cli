import * as acp from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'

import type {
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessMcpServer,
} from '../adapter'
import type { AcpProvider } from './command'

import { effectiveAgentEffort } from '../../../../shared/agent-effort'
import { childEnvironment, terminateProcessTree } from '../process'
import { effortConfig, effortValues, modelConfig } from './options'
import {
  providerEnvironment,
  providerMode,
  providerSessionMeta,
  type AcpProviderOptions,
} from './provider'

const SETUP_TIMEOUT_MS = 30_000
const DELETE_TIMEOUT_MS = 5_000
const MAX_STDERR = 16_000
const RESUME_REJECTED =
  /no (?:conversation|rollout|session|thread).*found|session not found|session .*?(?:not found|does not exist|expired)|thread.*?(?:not found|does not exist|expired)|could not (?:find|load|resume)|unknown (?:session|thread)|invalid (?:session|thread)(?: id)?|resume failed/i

type AcpInput = AgentTurnInput | AskInput

interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
  spawnError?: string
}

interface ExecutionResult {
  sessionId?: string
  text: string
  tokens?: number
  costUsd?: number
  isError: boolean
  errorMessage?: string
  resumeRejected?: boolean
  forkAttempted: boolean
}

function executableOnPath(command: string, pathValue: string | undefined): string | undefined {
  const extensions =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  for (const directory of (pathValue ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, command + extension)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined
}

function absoluteMcpCommand(
  server: HarnessMcpServer,
  cwd: string,
  env: Record<string, string> | undefined,
): string {
  if (isAbsolute(server.command)) return server.command
  if (server.command.includes('/') || server.command.includes('\\'))
    return resolve(cwd, server.command)
  const command = executableOnPath(server.command, env?.PATH ?? process.env.PATH)
  if (command) return command
  throw new Error(
    `ACP MCP server \`${server.name}\` command \`${server.command}\` was not found on PATH`,
  )
}

export function acpMcpServers(
  servers: HarnessMcpServer[] | undefined,
  cwd: string,
  env?: Record<string, string>,
): acp.McpServer[] {
  return (servers ?? []).map((server) => ({
    name: server.name,
    command: absoluteMcpCommand(server, cwd, env),
    args: server.args ?? [],
    env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
    _meta: {
      astrale: {
        required: server.required ?? false,
        approvalMode: server.approvalMode ?? null,
        enabledTools: server.enabledTools ?? [],
      },
    },
  }))
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function stderrSuffix(stderr: string): string {
  const text = stderr.trim()
  return text ? `: ${text.slice(-800)}` : ''
}

function toolTarget(update: acp.ToolCall | acp.ToolCallUpdate): string {
  const location = update.locations?.[0]
  if (location) return `${location.path}${location.line ? `:${location.line}` : ''}`
  const input = update.rawInput
  if (typeof input === 'string') return input.slice(0, 200)
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    const value =
      record.file_path ??
      record.path ??
      record.command ??
      record.pattern ??
      Object.values(record)[0]
    if (typeof value === 'string') return value.slice(0, 200)
    if (value !== undefined) return JSON.stringify(value).slice(0, 200)
  }
  return ''
}

function planText(entries: acp.PlanEntry[]): string {
  return entries
    .map((entry) => {
      const marker = entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '→' : '·'
      return `${marker} ${entry.content}`
    })
    .join('\n')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

function permissionResponse(params: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
  const option =
    params.options.find((candidate) => candidate.kind === 'allow_once') ??
    params.options.find((candidate) => candidate.kind === 'allow_always')
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}

async function executeAcp(
  options: AcpProviderOptions,
  input: AcpInput,
  ask: boolean,
): Promise<ExecutionResult> {
  if (input.signal.aborted)
    return {
      sessionId: input.sessionId,
      text: '',
      isError: true,
      errorMessage: 'canceled',
      forkAttempted: false,
    }

  let env: Record<string, string>
  let mcpServers: acp.McpServer[]
  try {
    env = providerEnvironment(options, input)
    mcpServers = acpMcpServers('mcpServers' in input ? input.mcpServers : [], input.root, env)
  } catch (error) {
    return {
      sessionId: input.sessionId,
      text: '',
      isError: true,
      errorMessage: errorText(error),
      forkAttempted: false,
    }
  }

  let stderr = ''
  let exited = false
  let resolveExit!: (exit: ProcessExit) => void
  const exit = new Promise<ProcessExit>((resolveProcessExit) => {
    resolveExit = resolveProcessExit
  })

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(options.command[0], options.command.slice(1), {
      cwd: input.root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(env),
      detached: process.platform !== 'win32',
    })
  } catch (error) {
    return {
      sessionId: input.sessionId,
      text: '',
      isError: true,
      errorMessage: `failed to spawn ${options.provider} ACP agent: ${errorText(error)}`,
      forkAttempted: false,
    }
  }

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

  const processFailure = (processExit: ProcessExit): Error =>
    new Error(
      processExit.spawnError
        ? `failed to spawn ${options.provider} ACP agent: ${processExit.spawnError}`
        : `${options.provider} ACP agent exited ${processExit.code ?? processExit.signal ?? -1}${stderrSuffix(stderr)}`,
    )

  const withProcess = async <T>(
    promise: Promise<T>,
    label: string,
    timeoutMs = SETUP_TIMEOUT_MS,
  ): Promise<T> => {
    const races: Promise<T>[] = [
      promise,
      exit.then((processExit) => Promise.reject(processFailure(processExit))),
    ]
    if (timeoutMs > 0)
      races.push(
        new Promise<T>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`${options.provider} ACP ${label} timed out`)),
            timeoutMs,
          )
          timer.unref?.()
        }),
      )
    return Promise.race(races)
  }

  let finalText = ''
  let pendingMessage = ''
  let pendingMessageId: string | undefined
  let costUsd: number | undefined
  const toolCalls = new Set<string>()
  const onEvent = 'onEvent' in input ? input.onEvent : undefined
  const onDelta = 'onDelta' in input ? input.onDelta : undefined

  const flushMessage = () => {
    const text = pendingMessage.trim()
    if (text && onEvent) onEvent({ kind: 'message', text })
    pendingMessage = ''
    pendingMessageId = undefined
  }

  const handleUpdate = (notification: acp.SessionNotification) => {
    const update = notification.update
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type !== 'text' || !update.content.text) return
        if (
          pendingMessage &&
          update.messageId &&
          pendingMessageId &&
          update.messageId !== pendingMessageId
        ) {
          flushMessage()
          if (finalText && !finalText.endsWith('\n')) {
            finalText += '\n\n'
            onDelta?.('\n\n')
          }
        }
        pendingMessageId = update.messageId ?? pendingMessageId
        pendingMessage += update.content.text
        finalText += update.content.text
        onDelta?.(update.content.text)
        return
      case 'agent_thought_chunk':
        if (update.content.type === 'text' && update.content.text.trim())
          onEvent?.({ kind: 'thinking', text: update.content.text.trim() })
        return
      case 'tool_call': {
        toolCalls.add(update.toolCallId)
        const tool = update.name ?? update.kind ?? update.title
        onEvent?.({
          kind: 'tool',
          text: update.title,
          tool,
          target: toolTarget(update),
        })
        return
      }
      case 'tool_call_update': {
        if (toolCalls.has(update.toolCallId) || (!update.title && !update.name)) return
        toolCalls.add(update.toolCallId)
        const tool = update.name ?? update.kind ?? update.title ?? 'tool'
        onEvent?.({
          kind: 'tool',
          text: update.title ?? tool,
          tool,
          target: toolTarget(update),
        })
        return
      }
      case 'plan': {
        const text = planText(update.entries)
        if (text) onEvent?.({ kind: 'status', text })
        return
      }
      case 'usage_update':
        if (update.cost?.currency.toUpperCase() === 'USD') costUsd = update.cost.amount
        return
      default:
        return
    }
  }

  let connection: acp.ClientConnection | undefined
  let context: acp.ClientContext | undefined
  let activeSessionId = input.sessionId
  let initializeResponse: acp.InitializeResponse | undefined
  let ephemeral = false
  let forkAttempted = false
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  let terminateTimer: ReturnType<typeof setTimeout> | undefined
  let onAbort = () => {}

  const stopAfterAbort = () => {
    if (terminateTimer) return
    if (context && activeSessionId)
      void context
        .notify(acp.methods.agent.session.cancel, { sessionId: activeSessionId })
        .catch(() => {})
    terminateTimer = setTimeout(() => terminateProcessTree(child), 100)
    terminateTimer.unref?.()
    forceKillTimer = setTimeout(() => terminateProcessTree(child, 'SIGKILL'), 2_100)
    forceKillTimer.unref?.()
  }

  const stopChild = async () => {
    try {
      connection?.close()
    } catch {
      /* already closed */
    }
    try {
      child.stdin?.end()
    } catch {
      /* already closed */
    }
    if (exited) return
    await Promise.race([exit.then(() => undefined), wait(750)])
    if (exited) return
    terminateProcessTree(child)
    await Promise.race([exit.then(() => undefined), wait(1_500)])
    if (exited) return
    terminateProcessTree(child, 'SIGKILL')
    await Promise.race([exit.then(() => undefined), wait(250)])
  }

  onAbort = stopAfterAbort
  input.signal.addEventListener('abort', onAbort, { once: true })

  let outcome: ExecutionResult
  try {
    const output = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>
    const source = Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>
    const stream = acp.ndJsonStream(output, source)
    const app = acp
      .client({ name: 'astrale-domain-studio' })
      .onRequest(acp.methods.client.session.requestPermission, (request) =>
        permissionResponse(request.params),
      )
      .onNotification(acp.methods.client.session.update, (notification) =>
        handleUpdate(notification.params),
      )
    connection = app.connect(stream)
    context = connection.agent

    const initialized = await withProcess<acp.InitializeResponse>(
      context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
        clientInfo: { name: 'astrale-domain-studio', title: 'Astrale Domain Studio' },
      }) as Promise<acp.InitializeResponse>,
      'initialize',
    )
    initializeResponse = initialized
    if (initialized.protocolVersion !== acp.PROTOCOL_VERSION)
      throw new Error(
        `${options.provider} ACP negotiated unsupported protocol version ${initialized.protocolVersion}`,
      )

    const capabilities = initialized.agentCapabilities?.sessionCapabilities
    const meta = providerSessionMeta(options.provider, input)
    let setup: acp.NewSessionResponse | acp.ResumeSessionResponse | acp.ForkSessionResponse

    if (ask && input.sessionId && capabilities?.fork) {
      forkAttempted = true
      const fork = await withProcess(
        context.request(acp.methods.agent.session.fork, {
          sessionId: input.sessionId,
          cwd: input.root,
          mcpServers,
          ...(meta ? { _meta: meta } : {}),
        }),
        'session fork',
      )
      activeSessionId = fork.sessionId
      ephemeral = true
      setup =
        fork.modes || fork.configOptions || !capabilities.resume
          ? fork
          : await withProcess(
              context.request(acp.methods.agent.session.resume, {
                sessionId: activeSessionId,
                cwd: input.root,
                mcpServers,
                ...(meta ? { _meta: meta } : {}),
              }),
              'fork resume',
            )
    } else if (!ask && input.sessionId) {
      if (!capabilities?.resume)
        throw new Error(`${options.provider} ACP agent does not support session/resume`)
      setup = await withProcess(
        context.request(acp.methods.agent.session.resume, {
          sessionId: input.sessionId,
          cwd: input.root,
          mcpServers,
          ...(meta ? { _meta: meta } : {}),
        }),
        'session resume',
      )
      activeSessionId = input.sessionId
    } else {
      const created = await withProcess(
        context.request(acp.methods.agent.session.new, {
          cwd: input.root,
          mcpServers,
          ...(meta ? { _meta: meta } : {}),
        }),
        'session creation',
      )
      setup = created
      activeSessionId = created.sessionId
      ephemeral = ask
    }

    onEvent?.({ kind: 'status', text: 'session started via ACP' })

    const desiredMode = providerMode(options.provider, input.access)
    if (setup.modes) {
      if (!setup.modes.availableModes.some((mode) => mode.id === desiredMode))
        throw new Error(`${options.provider} ACP mode \`${desiredMode}\` is unavailable`)
      if (setup.modes.currentModeId !== desiredMode)
        await withProcess(
          context.request(acp.methods.agent.session.setMode, {
            sessionId: activeSessionId,
            modeId: desiredMode,
          }),
          'mode selection',
        )
    }

    let configOptions = setup.configOptions ?? []
    const setConfig = async (config: acp.SessionConfigOption, category: string, value: string) => {
      const response = await withProcess(
        context!.request(acp.methods.agent.session.setConfigOption, {
          sessionId: activeSessionId!,
          configId: config.id,
          value,
        }),
        `${category} selection`,
      )
      configOptions = response.configOptions
    }

    if (input.model) {
      const config = modelConfig(configOptions)
      if (!config)
        throw new Error(`${options.provider} ACP agent did not expose its model selector`)
      await setConfig(config, 'model', input.model)
    }
    // The ladder belongs to the MODEL, so it is read after the model is set — and
    // a level this one does not offer lands on its nearest rung rather than
    // failing the turn. A model with no ladder at all (Haiku) is simply left alone.
    if (input.effort) {
      const config = effortConfig(configOptions)
      const level = effectiveAgentEffort(effortValues(config), input.effort)
      if (config && level && level !== config.currentValue)
        await setConfig(config, 'thought_level', level)
    }

    if (input.signal.aborted) throw new Error('canceled')
    const promptResponse = await withProcess(
      context.request(acp.methods.agent.session.prompt, {
        sessionId: activeSessionId,
        prompt: [{ type: 'text', text: input.prompt }],
      }),
      'prompt',
      0,
    )
    flushMessage()

    const stoppedCleanly = promptResponse.stopReason === 'end_turn'
    const canceled = input.signal.aborted || promptResponse.stopReason === 'cancelled'
    outcome = {
      sessionId: activeSessionId,
      text: finalText.trim(),
      tokens: promptResponse.usage?.totalTokens,
      costUsd,
      isError: !stoppedCleanly,
      errorMessage: stoppedCleanly
        ? undefined
        : canceled
          ? 'canceled'
          : `agent stopped: ${promptResponse.stopReason}`,
      forkAttempted,
    }
  } catch (error) {
    flushMessage()
    const canceled = input.signal.aborted
    const message = canceled ? 'canceled' : errorText(error) + stderrSuffix(stderr)
    outcome = {
      sessionId: activeSessionId,
      text: finalText.trim(),
      costUsd,
      isError: true,
      errorMessage: message,
      resumeRejected:
        !ask && !!input.sessionId && !canceled && RESUME_REJECTED.test(`${message}\n${stderr}`),
      forkAttempted,
    }
  } finally {
    if (
      ephemeral &&
      activeSessionId &&
      context &&
      initializeResponse?.agentCapabilities?.sessionCapabilities?.delete &&
      !input.signal.aborted
    )
      await withProcess(
        context.request(acp.methods.agent.session.delete, { sessionId: activeSessionId }),
        'session deletion',
        DELETE_TIMEOUT_MS,
      ).catch(() => {})
    input.signal.removeEventListener('abort', onAbort)
    if (terminateTimer) clearTimeout(terminateTimer)
    if (forceKillTimer) clearTimeout(forceKillTimer)
    await stopChild()
  }

  return outcome
}

export async function runAcpTurn(
  options: AcpProviderOptions,
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const result = await executeAcp(options, input, false)
  return {
    sessionId: result.sessionId,
    finalText: result.text,
    costUsd: result.costUsd,
    numTurns: result.isError && !result.text ? undefined : 1,
    tokens: result.tokens,
    isError: result.isError,
    errorMessage: result.errorMessage,
    resumeRejected: result.resumeRejected,
  }
}

export async function runAcpAsk(options: AcpProviderOptions, input: AskInput): Promise<AskResult> {
  let result = await executeAcp(options, input, true)
  if (result.isError && result.forkAttempted && !result.text && result.errorMessage !== 'canceled')
    result = await executeAcp(options, { ...input, sessionId: undefined }, true)
  return {
    text: result.text,
    isError: result.isError,
    errorMessage: result.errorMessage,
  }
}

export type { AcpProvider }
