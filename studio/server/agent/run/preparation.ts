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
import type { StoredChat } from '../chats'
import type { AgentHarness } from '../harness/adapter'

import { getBundle } from '../../cache'
import { refreshAuto } from '../../handoff/service'
import { readComments } from '../../state/comments'
import { readContext } from '../../state/context'
import { listDocuments } from '../../state/documents'
import { startBridge } from '../bridge/grant'
import { pendingHandoff } from '../chats'
import { getHarnessById } from '../harness/registry'
import { resolveHarnessConfiguration } from '../harness/selection'
import { buildSystemPrompt } from '../prompts/system'
import { buildResumePrompt, buildTurnPrompt } from '../prompts/turn'
import { studioSessionId } from '../telemetry'
import { handoffPreamble } from '../transfer'

export interface SubmitOpts {
  message?: string
  resume?: boolean
}

export interface PreparedRun {
  domainId: string
  root: string
  chat: StoredChat
  harness: AgentHarness
  settings: StudioSettings
  resume?: string
  renderFingerprint: string
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

/** Gather and freeze every input required to start one agent run in one chat. */
export async function prepareRun(
  handle: DomainHandle,
  chat: StoredChat,
  notify: (event: StudioEvent) => void,
  controller: AbortController,
  options?: SubmitOpts,
): Promise<PreparationResult> {
  const domainId = handle.id
  const root = handle.root
  // The chat owns its harness for life, so the domain's current selection is
  // irrelevant here: a Claude tab keeps running Claude after the user picks Codex.
  const harness = getHarnessById(chat.harness)
  const available = await harness.isAvailable(controller.signal)
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }
  if (!available) return { error: `${harness.label} is not available on this machine` }

  const resume = chat.sessionId
  const bareResume = options?.resume === true && !!resume
  const awaiting = awaitingThreads(root)
  const message = (options?.message ?? '').trim()
  // A turn has to carry something, and a message is only one of the three things it
  // can be: an attached document is an instruction in itself ("read this"), and so is
  // an open thread. Only a turn carrying none of them is nothing to send.
  const documents = listDocuments(root)
  if (!bareResume && awaiting.length === 0 && !message && documents.length === 0)
    return { error: 'nothing to send — type an instruction, attach a document or open a thread' }

  await refreshAuto(handle).catch(() => {})
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }
  const bundle = await getBundle(domainId)
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }

  const renderFingerprint = bundle?.renderFingerprint ?? ''
  const context = readContext(root)
  const configuration = await resolveHarnessConfiguration(root, harness, {
    ...(chat.model ? { model: chat.model } : {}),
    ...(chat.effort ? { effort: chat.effort } : {}),
  })
  if (!configuration.ok) return { error: `model gateway auth failed — ${configuration.error}` }
  const { settings, model, effort, env } = configuration.configuration
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }

  const harnessEnv = { ...env, ASTRALE_SESSION: studioSessionId(domainId) }
  const bridge = startBridge(handle, notify)
  // A forked tab opens on the summary of the conversation it came from — once,
  // on the turn that actually starts its own session. The summary itself stays
  // on the chat afterwards; only its delivery is one-shot.
  const owed = pendingHandoff(chat)
  const handoff = owed ? handoffPreamble(owed) : ''
  const makeTurn = (firstTurn: boolean) =>
    bareResume && !firstTurn
      ? buildResumePrompt()
      : (firstTurn ? handoff : '') +
        buildTurnPrompt({
          origin: bundle?.ir?.domain ?? handle.origin ?? domainId,
          root,
          renderFingerprint,
          schemaRevision: bundle?.schemaRevision,
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
    chatId: chat.id,
    harness: harness.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    // named after whatever the turn actually carries, in the order it was meant
    summary: bareResume
      ? 'continuing after interruption'
      : message
        ? message.slice(0, 60) + (message.length > 60 ? '…' : '')
        : awaiting.length > 0
          ? awaiting.length === 1
            ? '1 open thread'
            : `${awaiting.length} open threads`
          : documents.length === 1
            ? '1 document'
            : `${documents.length} documents`,
    ...(message ? { instruction: message } : {}),
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
      chat,
      harness,
      settings,
      resume,
      renderFingerprint,
      model,
      effort,
      harnessEnv,
      bridge,
      run,
      promptSnapshot,
    },
  }
}
