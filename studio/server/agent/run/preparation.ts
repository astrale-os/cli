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
import type { DomainTurnParts } from '../prompts/turn'
import type { AgentWorkspace } from '../workspace'

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
import { briefedDomains, buildResumePrompt, buildTurnPrompt } from '../prompts/turn'
import { studioSessionId } from '../telemetry'
import { handoffPreamble } from '../transfer'
import { domainOrigin, domainRelativePath } from '../workspace'

export interface SubmitOpts {
  message?: string
  resume?: boolean
}

export interface PreparedRun {
  workspace: AgentWorkspace
  chat: StoredChat
  harness: AgentHarness
  settings: StudioSettings
  resume?: string
  /** the domains this turn briefs, with the fingerprint each reply block would name */
  briefed: { handle: DomainHandle; renderFingerprint: string }[]
  model?: string
  effort?: AgentEffort
  harnessEnv: Record<string, string>
  bridge: Bridge
  run: AgentRun
  promptSnapshot(sessionId: string | undefined, firstTurn: boolean): AgentPromptSnapshot
}

export type PreparationResult = { prepared: PreparedRun } | { error: string }

function awaitingThreads(comments: Comment[]): Comment[] {
  return comments.filter(
    (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
  )
}

/**
 * What one domain brings to the turn. Every domain is read for its counts — the
 * digest lists them all — but only a domain that carries something (a thread awaiting
 * the agent, a document) is refreshed and introspected: that is what a briefing costs,
 * and a domain nobody asked about is a line in the digest.
 */
async function domainParts(
  workspace: AgentWorkspace,
  handle: DomainHandle,
  signal: AbortSignal,
): Promise<DomainTurnParts> {
  const open = readComments(handle.root).comments.filter((comment) => comment.status === 'open')
  const awaiting = awaitingThreads(open)
  const documents = listDocuments(handle.root)
  const base: DomainTurnParts = {
    origin: domainOrigin(handle),
    root: handle.root,
    relativePath: domainRelativePath(workspace, handle),
    renderFingerprint: '',
    openThreads: open.length,
    awaitingThreads: awaiting,
    userContext: [],
    autoContext: [],
    documents,
    ir: null,
  }
  if (awaiting.length === 0 && documents.length === 0) return base
  await refreshAuto(handle).catch(() => {})
  if (signal.aborted) return base
  const bundle = await getBundle(handle.id)
  const context = readContext(handle.root)
  return {
    ...base,
    origin: bundle?.ir?.domain ?? base.origin,
    renderFingerprint: bundle?.renderFingerprint ?? '',
    schemaRevision: bundle?.schemaRevision,
    userContext: context.user,
    autoContext: context.auto.filter((item) => item.includeInHandoff),
    ir: bundle?.ir ?? null,
    overlay: bundle?.overlay,
  }
}

/** Gather and freeze every input required to start one agent run in one chat. */
export async function prepareRun(
  workspace: AgentWorkspace,
  chat: StoredChat,
  notify: (event: StudioEvent) => void,
  controller: AbortController,
  options?: SubmitOpts,
): Promise<PreparationResult> {
  // The chat owns its harness for life, so the current selection is irrelevant
  // here: a Claude tab keeps running Claude after the user picks Codex.
  const harness = getHarnessById(chat.harness)
  const available = await harness.isAvailable(controller.signal)
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }
  if (!available) return { error: `${harness.label} is not available on this machine` }

  const resume = chat.sessionId
  const bareResume = options?.resume === true && !!resume
  const message = (options?.message ?? '').trim()
  const domains: DomainTurnParts[] = []
  for (const handle of workspace.domains) {
    domains.push(await domainParts(workspace, handle, controller.signal))
    if (controller.signal.aborted) return { error: 'agent run canceled during setup' }
  }
  const briefed = briefedDomains(domains)
  const awaiting = briefed.flatMap((domain) => domain.awaitingThreads)
  const documents = briefed.reduce((n, domain) => n + domain.documents.length, 0)
  // A turn has to carry something, and a message is only one of the three things it
  // can be: an attached document is an instruction in itself ("read this"), and so is
  // an open thread. Only a turn carrying none of them is nothing to send.
  if (!bareResume && awaiting.length === 0 && !message && documents === 0)
    return { error: 'nothing to send — type an instruction, attach a document or open a thread' }

  const configuration = await resolveHarnessConfiguration(harness, {
    ...(chat.model ? { model: chat.model } : {}),
    ...(chat.effort ? { effort: chat.effort } : {}),
  })
  if (!configuration.ok) return { error: `model gateway auth failed — ${configuration.error}` }
  const { settings, model, effort, env } = configuration.configuration
  if (controller.signal.aborted) return { error: 'agent run canceled during setup' }

  const harnessEnv = { ...env, ASTRALE_SESSION: studioSessionId(workspace.key) }
  const bridge = startBridge(workspace, notify)
  // A forked tab opens on the summary of the conversation it came from — once,
  // on the turn that actually starts its own session. The summary itself stays
  // on the chat afterwards; only its delivery is one-shot.
  const owed = pendingHandoff(chat)
  const handoff = owed ? handoffPreamble(owed) : ''
  const makeTurn = (firstTurn: boolean) =>
    bareResume && !firstTurn
      ? buildResumePrompt()
      : (firstTurn ? handoff : '') +
        buildTurnPrompt({ workspaceRoot: workspace.root, domains, firstTurn, message })
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
          : documents === 1
            ? '1 document'
            : `${documents} documents`,
    ...(message ? { instruction: message } : {}),
    targetCommentIds: awaiting.map((comment) => comment.id),
    events: [],
    sessionId: resume,
    resumed: !!resume,
    prompt: promptSnapshot(resume, !resume),
  }

  return {
    prepared: {
      workspace,
      chat,
      harness,
      settings,
      resume,
      briefed: briefed.map((domain) => ({
        handle: workspace.domains.find((handle) => handle.root === domain.root)!,
        renderFingerprint: domain.renderFingerprint,
      })),
      model,
      effort,
      harnessEnv,
      bridge,
      run,
      promptSnapshot,
    },
  }
}
