import * as acp from '@agentclientprotocol/sdk'
import { accessSync, constants, readFileSync } from 'node:fs'
import { delimiter, isAbsolute, resolve } from 'node:path'

import type {
  AgentTurnImage,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessMcpServer,
} from '../adapter'
import type { AcpAgentProcess } from './agent-process'
import type { AcpProvider } from './command'

import { effectiveAgentEffort } from '../../../../shared/agent-effort'
import { terminateProcessTree } from '../process'
import { initializeAgent, spawnAcpAgent } from './agent-process'
import { effortConfig, effortValues, fastConfig, fastValue, modelConfig } from './options'
import {
  providerEnvironment,
  providerMode,
  providerSessionMeta,
  type AcpProviderOptions,
} from './provider'

const SETUP_TIMEOUT_MS = 30_000
const DELETE_TIMEOUT_MS = 5_000
const RESUME_REJECTED =
  /no (?:conversation|rollout|session|thread).*found|session not found|session .*?(?:not found|does not exist|expired)|thread.*?(?:not found|does not exist|expired)|could not (?:find|load|resume)|unknown (?:session|thread)|invalid (?:session|thread)(?: id)?|resume failed/i

type AcpInput = AgentTurnInput | AskInput

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

/**
 * What `session/prompt` carries: the images first, as images, then the text that
 * talks about them. An agent that does not take images gets the text alone — the
 * prompt already lists each image's path, so the message still reaches it whole.
 */
export function promptBlocks(
  prompt: string,
  images: readonly AgentTurnImage[] | undefined,
  acceptsImages: boolean,
): acp.ContentBlock[] {
  const pictures: acp.ContentBlock[] = acceptsImages
    ? (images ?? []).map((image) => ({
        type: 'image',
        mimeType: image.mimeType,
        data: readFileSync(image.path).toString('base64'),
      }))
    : []
  return [...pictures, { type: 'text', text: prompt }]
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

/**
 * A JSON-RPC failure keeps its real cause in `data` ("Internal error" alone says
 * nothing), so the code and the data travel with the message: the first line stays
 * the headline the chat shows, the rest is what the details view is for.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return String(error)
  const { code, data } = error as Error & { code?: unknown; data?: unknown }
  if (typeof code !== 'number') return error.message
  const detail =
    data === undefined || data === null
      ? ''
      : typeof data === 'string'
        ? data.trim()
        : JSON.stringify(data, null, 2)
  const lines = [`${error.message} (JSON-RPC ${code})`]
  if (detail && !error.message.includes(detail)) lines.push(detail)
  return lines.join('\n')
}

/** The agent's own stderr tail, on its own block so it never swallows the headline. */
function stderrSuffix(stderr: string): string {
  const text = stderr.trim()
  return text ? `\n\nstderr (tail):\n${text.slice(-2000)}` : ''
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

function permissionResponse(params: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
  const option =
    params.options.find((candidate) => candidate.kind === 'allow_once') ??
    params.options.find((candidate) => candidate.kind === 'allow_always')
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}

/**
 * Folds the agent's `session/update` stream into Studio's activity events and the
 * reply text. A new `messageId` starts a new paragraph: the previous message is
 * flushed as its own event and the reply gets a blank line between the two.
 */
function transcript(
  onEvent: AgentTurnInput['onEvent'] | undefined,
  onDelta: AskInput['onDelta'] | undefined,
) {
  let text = ''
  let pendingMessage = ''
  let pendingMessageId: string | undefined
  let costUsd: number | undefined
  const toolCalls = new Set<string>()

  const flush = () => {
    const message = pendingMessage.trim()
    if (message && onEvent) onEvent({ kind: 'message', text: message })
    pendingMessage = ''
    pendingMessageId = undefined
  }

  const handle = (notification: acp.SessionNotification) => {
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
          flush()
          if (text && !text.endsWith('\n')) {
            text += '\n\n'
            onDelta?.('\n\n')
          }
        }
        pendingMessageId = update.messageId ?? pendingMessageId
        pendingMessage += update.content.text
        text += update.content.text
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
        const plan = planText(update.entries)
        if (plan) onEvent?.({ kind: 'status', text: plan })
        return
      }
      case 'usage_update':
        if (update.cost?.currency.toUpperCase() === 'USD') costUsd = update.cost.amount
        return
      default:
        return
    }
  }

  return {
    handle,
    flush,
    get text() {
      return text
    },
    get costUsd() {
      return costUsd
    },
  }
}

async function executeAcp(
  options: AcpProviderOptions,
  input: AcpInput,
  ask: boolean,
): Promise<ExecutionResult> {
  const failedBeforeStart = (errorMessage: string): ExecutionResult => ({
    sessionId: input.sessionId,
    text: '',
    isError: true,
    errorMessage,
    forkAttempted: false,
  })
  if (input.signal.aborted) return failedBeforeStart('canceled')

  let env: Record<string, string>
  let mcpServers: acp.McpServer[]
  try {
    env = providerEnvironment(options, input)
    mcpServers = acpMcpServers('mcpServers' in input ? input.mcpServers : [], input.root, env)
  } catch (error) {
    return failedBeforeStart(errorText(error))
  }

  let agent: AcpAgentProcess
  try {
    agent = spawnAcpAgent(options.provider, options.command, input.root, env)
  } catch (error) {
    return failedBeforeStart(`failed to spawn ${options.provider} ACP agent: ${errorText(error)}`)
  }
  const { child, exit } = agent

  const withProcess = async <T>(
    promise: Promise<T>,
    label: string,
    timeoutMs = SETUP_TIMEOUT_MS,
  ): Promise<T> => {
    const races: Promise<T>[] = [
      promise,
      exit.then((processExit) => Promise.reject(agent.failure(processExit, stderrSuffix))),
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

  const onEvent = 'onEvent' in input ? input.onEvent : undefined
  const reply = transcript(onEvent, 'onDelta' in input ? input.onDelta : undefined)

  let connection: acp.ClientConnection | undefined
  let context: acp.ClientContext | undefined
  let activeSessionId = input.sessionId
  let initializeResponse: acp.InitializeResponse | undefined
  let ephemeral = false
  let forkAttempted = false
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  let terminateTimer: ReturnType<typeof setTimeout> | undefined

  const onAbort = () => {
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
  input.signal.addEventListener('abort', onAbort, { once: true })

  let outcome: ExecutionResult
  try {
    const app = acp
      .client({ name: 'astrale-domain-studio' })
      .onRequest(acp.methods.client.session.requestPermission, (request) =>
        permissionResponse(request.params),
      )
      .onNotification(acp.methods.client.session.update, (notification) =>
        reply.handle(notification.params),
      )
    connection = app.connect(agent.stream())
    context = connection.agent

    const initialized = await initializeAgent(
      context,
      options.provider,
      { name: 'astrale-domain-studio', title: 'Astrale Domain Studio' },
      withProcess,
    )
    initializeResponse = initialized

    const capabilities = initialized.agentCapabilities?.sessionCapabilities
    const meta = providerSessionMeta(options.provider, input)
    const sessionParams: acp.NewSessionRequest = {
      cwd: input.root,
      mcpServers,
      ...(meta ? { _meta: meta } : {}),
    }
    let setup: acp.NewSessionResponse | acp.ResumeSessionResponse | acp.ForkSessionResponse

    if (ask && input.sessionId && capabilities?.fork) {
      forkAttempted = true
      const fork = await withProcess(
        context.request(acp.methods.agent.session.fork, {
          sessionId: input.sessionId,
          ...sessionParams,
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
                ...sessionParams,
              }),
              'fork resume',
            )
    } else if (!ask && input.sessionId) {
      if (!capabilities?.resume)
        throw new Error(`${options.provider} ACP agent does not support session/resume`)
      setup = await withProcess(
        context.request(acp.methods.agent.session.resume, {
          sessionId: input.sessionId,
          ...sessionParams,
        }),
        'session resume',
      )
      activeSessionId = input.sessionId
    } else {
      const created = await withProcess(
        context.request(acp.methods.agent.session.new, sessionParams),
        'session creation',
      )
      setup = created
      activeSessionId = created.sessionId
      ephemeral = ask
    }
    const sessionId = activeSessionId

    onEvent?.({ kind: 'status', text: 'session started via ACP' })

    const desiredMode = providerMode(options.provider, input.access)
    if (setup.modes) {
      if (!setup.modes.availableModes.some((mode) => mode.id === desiredMode))
        throw new Error(`${options.provider} ACP mode \`${desiredMode}\` is unavailable`)
      if (setup.modes.currentModeId !== desiredMode)
        await withProcess(
          context.request(acp.methods.agent.session.setMode, { sessionId, modeId: desiredMode }),
          'mode selection',
        )
    }

    let configOptions = setup.configOptions ?? []
    const setConfig = async (
      config: acp.SessionConfigOption,
      category: string,
      value: string | boolean,
    ) => {
      const response = await withProcess<acp.SetSessionConfigOptionResponse>(
        context!.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
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
    const fast = fastConfig(configOptions)
    if (fast && input.fastMode !== undefined)
      await setConfig(fast, 'fast mode', fastValue(fast, input.fastMode))
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
        sessionId,
        prompt: promptBlocks(
          input.prompt,
          'images' in input ? input.images : undefined,
          initialized.agentCapabilities?.promptCapabilities?.image === true,
        ),
      }),
      'prompt',
      0,
    )
    reply.flush()

    const stoppedCleanly = promptResponse.stopReason === 'end_turn'
    const canceled = input.signal.aborted || promptResponse.stopReason === 'cancelled'
    outcome = {
      sessionId,
      text: reply.text.trim(),
      tokens: promptResponse.usage?.totalTokens,
      costUsd: reply.costUsd,
      isError: !stoppedCleanly,
      errorMessage: stoppedCleanly
        ? undefined
        : canceled
          ? 'canceled'
          : `agent stopped: ${promptResponse.stopReason}`,
      forkAttempted,
    }
  } catch (error) {
    reply.flush()
    const canceled = input.signal.aborted
    const stderr = agent.stderr
    const message = canceled ? 'canceled' : errorText(error) + stderrSuffix(stderr)
    outcome = {
      sessionId: activeSessionId,
      text: reply.text.trim(),
      costUsd: reply.costUsd,
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
    try {
      connection?.close()
    } catch {
      /* already closed */
    }
    await agent.shutdown(750, 1_500, 250)
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
