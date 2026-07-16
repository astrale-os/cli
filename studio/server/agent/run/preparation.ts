import { randomUUID } from 'node:crypto'

import type {
  AgentPromptSnapshot,
  AgentRun,
  AgentEffort,
  Comment,
  StudioEvent,
  StudioSettings,
} from '../../../shared/types'
import type { DomainHandle } from '../../domain'
import type { Bridge } from '../bridge/grant'
import type { AgentHarness } from '../harness/adapter'

import { getBundle } from '../../cache'
import { readComments } from '../../state/comments'
import { readContext } from '../../state/context'
import { listDocuments } from '../../state/documents'
import { refreshAuto } from '../../state/handoff'
import { startBridge } from '../bridge/grant'
import { readConversation } from '../conversation'
import { getHarness, resolveHarnessConfiguration } from '../harness/selection'
import { buildSystemPrompt } from '../prompts/system'
import { buildResumePrompt, buildTurnPrompt } from '../prompts/turn'
import { studioSessionId } from '../telemetry'

export interface SubmitOpts {
  message?: string
  resume?: boolean
}

export interface PreparedRun {
  domainId: string
  root: string
  harness: AgentHarness
  settings: StudioSettings
  session: ReturnType<typeof readConversation>
  resume?: string
  schemaHash: string
  model?: string
  effort?: AgentEffort
  harnessEnv: Record<string, string>
  bridge: Bridge
  run: AgentRun
  promptSnapshot(sessionId: string | undefined, firstTurn: boolean): AgentPromptSnapshot
}

export type PreparationResult = { prepared: PreparedRun } | { error: string }

function awaitingThreads(root: string): Comment[] {
  return readComments(root).comments.filter(
    (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
  )
}

/** Gather and freeze every input required to start one agent run. */
export async function prepareRun(
  handle: DomainHandle,
  notify: (event: StudioEvent) => void,
  controller: AbortController,
  options?: SubmitOpts,
): Promise<PreparationResult> {
  const domainId = handle.id
  const root = handle.root
  const harness = getHarness(root)
  const available = await harness.isAvailable(controller.signal)
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }
  if (!available) return { error: `${harness.label} is not available on this machine` }

  const session = readConversation(root, harness.id)
  const resume = session.sessionId
  const bareResume = options?.resume === true && !!resume
  const awaiting = awaitingThreads(root)
  const message = (options?.message ?? '').trim()
  if (!bareResume && awaiting.length === 0 && !message)
    return { error: 'nothing to send — type an instruction or open a thread' }

  await refreshAuto(handle).catch(() => {})
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }
  const bundle = await getBundle(domainId)
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }

  const schemaHash = bundle?.schemaHash ?? ''
  const context = readContext(root)
  const documents = listDocuments(root)
  const configuration = await resolveHarnessConfiguration(root, harness)
  if (!configuration.ok) return { error: `model gateway auth failed — ${configuration.error}` }
  const { settings, model, effort, env } = configuration.configuration
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }

  const harnessEnv = { ...env, ASTRALE_SESSION: studioSessionId(domainId) }
  const bridge = startBridge(handle, notify)
  const makeTurn = (firstTurn: boolean) =>
    bareResume && !firstTurn
      ? buildResumePrompt()
      : buildTurnPrompt({
          origin: bundle?.overlay.origin ?? domainId,
          root,
          schemaHash,
          awaitingThreads: awaiting,
          userContext: context.user,
          autoContext: context.auto.filter((item) => item.includeInHandoff),
          documents,
          firstTurn,
          message,
          ir: bundle?.ir ?? null,
          overlay: bundle?.overlay,
        })
  const systemPrompt = buildSystemPrompt({ bridge: bridge.enabled })
  const promptSnapshot = (
    sessionId: string | undefined,
    firstTurn: boolean,
  ): AgentPromptSnapshot => ({
    createdAt: new Date().toISOString(),
    systemPrompt,
    turnPrompt: makeTurn(firstTurn),
    firstTurn,
    resumed: !!sessionId,
    sessionId,
    model,
    effort,
    access: settings.agentAccess,
    mcpTools: bridge.mcpServers.flatMap((server) => server.enabledTools ?? []),
  })
  const run: AgentRun = {
    id: randomUUID(),
    domainId,
    harness: harness.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    summary: bareResume
      ? 'continuing after interruption'
      : message
        ? message.slice(0, 60) + (message.length > 60 ? '…' : '')
        : awaiting.length === 1
          ? '1 open thread'
          : `${awaiting.length} open threads`,
    targetCommentIds: awaiting.map((comment) => comment.id),
    events: [],
    sessionId: resume,
    resumed: !!resume,
    prompt: promptSnapshot(resume, !resume),
  }

  return {
    prepared: {
      domainId,
      root,
      harness,
      settings,
      session,
      resume,
      schemaHash,
      model,
      effort,
      harnessEnv,
      bridge,
      run,
      promptSnapshot,
    },
  }
}
