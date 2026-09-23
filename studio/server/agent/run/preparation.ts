import { randomUUID } from 'node:crypto'

import type {
  AgentPromptSnapshot,
  AgentRun,
  AgentEffort,
  ChatAttachment,
  Comment,
  StudioSettings,
} from '../../../shared/types'
import type { DomainHandle } from '../../domain'
import type { Bridge } from '../bridge/grant'
import type { StoredChat } from '../chats'
import type { AgentHarness, AgentTurnImage } from '../harness/adapter'
import type { Notify } from '../notify'
import type { DomainTurnParts } from '../prompts/turn'
import type { AgentWorkspace } from '../workspace'

import { imagesLabel } from '../../../shared/attachments'
import { getBundle } from '../../cache'
import { refreshAuto } from '../../handoff/service'
import { readComments } from '../../state/comments'
import { readContext } from '../../state/context'
import { listDocuments } from '../../state/documents'
import { attachmentFiles, resolveAttachments } from '../attachments'
import { startBridge } from '../bridge/grant'
import { pendingHandoff } from '../chats'
import { getHarnessById } from '../harness/registry'
import { resolveHarnessConfiguration } from '../harness/selection'
import { buildSystemPrompt } from '../prompts/system'
import { briefedDomains, buildResumePrompt, buildTurnPrompt } from '../prompts/turn'
import { studioSessionId } from '../telemetry'
import { handoffPreamble } from '../transfer'
import { domainOrigin, domainRelativePath } from '../workspace'

/**
 * Which open threads a turn carries. None unless asked: an open thread is the
 * user's to bring into a turn, not something every message drags along. `'all'`
 * is the explicit "answer the threads" of the header button.
 */
export type CommentSelection = 'all' | string[]

export interface SubmitOpts {
  message?: string
  resume?: boolean
  comments?: CommentSelection
  /** ids of the images this message carries, uploaded to its chat beforehand */
  attachments?: string[]
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
  fastMode?: boolean
  harnessEnv: Record<string, string>
  bridge: Bridge
  run: AgentRun
  /** the images the harness is handed with the prompt, read from the chat's store */
  images: AgentTurnImage[]
  promptSnapshot(sessionId: string | undefined, firstTurn: boolean): AgentPromptSnapshot
}

export type PreparationResult = { prepared: PreparedRun } | { error: string }

const CANCELED_DURING_SETUP = 'agent run canceled during setup'

function awaitingThreads(comments: Comment[]): Comment[] {
  return comments.filter(
    (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
  )
}

/** Every thread awaiting the agent across the workspace, by id — what `'all'` means now. */
export function awaitingThreadIds(workspace: AgentWorkspace): string[] {
  return workspace.domains.flatMap((handle) =>
    awaitingThreads(readComments(handle.root).comments).map((comment) => comment.id),
  )
}

/** The awaiting threads the user chose to attach to this turn. */
function attachedThreads(awaiting: Comment[], selection: CommentSelection | undefined): Comment[] {
  if (selection === 'all') return awaiting
  if (!selection?.length) return []
  const chosen = new Set(selection)
  return awaiting.filter((comment) => chosen.has(comment.id))
}

/**
 * What one domain brings to the turn. Every domain is read for its counts — the
 * digest lists them all — but only a domain that carries something (a thread the
 * user attached, a document) is refreshed and introspected: that is what a briefing
 * costs, and a domain nobody asked about is a line in the digest.
 */
async function domainParts(
  workspace: AgentWorkspace,
  handle: DomainHandle,
  signal: AbortSignal,
  selection: CommentSelection | undefined,
): Promise<DomainTurnParts> {
  const open = readComments(handle.root).comments.filter((comment) => comment.status === 'open')
  const pending = awaitingThreads(open)
  const awaiting = attachedThreads(pending, selection)
  const documents = listDocuments(handle.root)
  const base: DomainTurnParts = {
    origin: domainOrigin(handle),
    root: handle.root,
    relativePath: domainRelativePath(workspace, handle),
    renderFingerprint: '',
    openThreads: open.length,
    pendingThreads: pending.length,
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

/** A run is named after whatever its turn actually carries, in the order it was meant. */
function runSummary(turn: {
  bareResume: boolean
  message: string
  images: number
  threads: number
  documents: number
}): string {
  if (turn.bareResume) return 'continuing after interruption'
  if (turn.message) return turn.message.slice(0, 60) + (turn.message.length > 60 ? '…' : '')
  if (turn.images > 0) return imagesLabel(turn.images)
  if (turn.threads > 0)
    return turn.threads === 1 ? '1 attached thread' : `${turn.threads} attached threads`
  return turn.documents === 1 ? '1 document' : `${turn.documents} documents`
}

/** Gather and freeze every input required to start one agent run in one chat. */
export async function prepareRun(
  workspace: AgentWorkspace,
  chat: StoredChat,
  notify: Notify,
  controller: AbortController,
  options?: SubmitOpts,
): Promise<PreparationResult> {
  // The chat owns its harness for life, so the current selection is irrelevant
  // here: a Claude tab keeps running Claude after the user picks Codex.
  const harness = getHarnessById(chat.harness)
  const available = await harness.isAvailable(controller.signal)
  if (controller.signal.aborted) return { error: CANCELED_DURING_SETUP }
  if (!available) return { error: `${harness.label} is not available on this machine` }

  const resume = chat.sessionId
  const bareResume = options?.resume === true && !!resume
  const message = (options?.message ?? '').trim()
  const resolved = resolveAttachments(workspace.stateRoot, chat.id, options?.attachments ?? [])
  if ('error' in resolved) return resolved
  const attachments: ChatAttachment[] = bareResume ? [] : resolved.attachments
  const images: AgentTurnImage[] = attachmentFiles(workspace.stateRoot, chat.id, attachments).map(
    ({ attachment, path }) => ({ path, mimeType: attachment.mimeType, name: attachment.name }),
  )
  const domains: DomainTurnParts[] = []
  for (const handle of workspace.domains) {
    domains.push(await domainParts(workspace, handle, controller.signal, options?.comments))
    if (controller.signal.aborted) return { error: CANCELED_DURING_SETUP }
  }
  const briefed = briefedDomains(domains)
  const awaiting = briefed.flatMap((domain) => domain.awaitingThreads)
  const documents = briefed.reduce((n, domain) => n + domain.documents.length, 0)
  // A turn has to carry something, and text is only one of the things it can be: an
  // image is a message in itself ("look at this"), an attached document is an
  // instruction ("read this"), and so is an attached thread. Only a turn carrying
  // none of them is nothing to send.
  if (!bareResume && awaiting.length === 0 && !message && !attachments.length && documents === 0)
    return {
      error: 'nothing to send — type an instruction, attach an image, a document or a thread',
    }

  const configuration = await resolveHarnessConfiguration(harness, {
    ...(chat.model ? { model: chat.model } : {}),
    ...(chat.effort ? { effort: chat.effort } : {}),
  })
  if (!configuration.ok) return { error: `model gateway auth failed — ${configuration.error}` }
  const { settings, model, effort, env } = configuration.configuration
  if (controller.signal.aborted) return { error: CANCELED_DURING_SETUP }

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
        buildTurnPrompt({
          workspaceRoot: workspace.root,
          domains,
          firstTurn,
          message,
          images,
          ...(firstTurn && chat.turns === 0 && chat.newDomain ? { newDomain: chat.newDomain } : {}),
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
    chatId: chat.id,
    harness: harness.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    summary: runSummary({
      bareResume,
      message,
      images: attachments.length,
      threads: awaiting.length,
      documents,
    }),
    ...(message ? { instruction: message } : {}),
    ...(attachments.length ? { attachments } : {}),
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
      fastMode: chat.fastMode,
      harnessEnv,
      bridge,
      run,
      images,
      promptSnapshot,
    },
  }
}
