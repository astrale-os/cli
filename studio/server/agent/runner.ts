/**
 * agent/runner.ts — orchestrates one live agent turn per domain.
 *
 * submit → gather the threads awaiting a reply + current changes + context →
 * scaffold the prompt → run the harness (streaming activity to SSE) → on finish,
 * merge the agent's machine-state reply block back into comments.json and persist
 * the session id so the next turn resumes the same conversation. The agent's file
 * edits flow through the existing watch→re-render path with no extra plumbing.
 *
 * One run at a time per domain; the live run is held in memory and mirrored to
 * the client over SSE, then a compact transcript is written under
 * `.domain-studio/.cache/agent/` (ignored, never pollutes committed state).
 */
import { randomUUID } from 'node:crypto'

import type {
  AgentEvent,
  AgentPromptSnapshot,
  AgentRun,
  AgentRunSnapshot,
  Comment,
  ConversationInfo,
  StudioEvent,
} from '../../shared/types'

import { getBundle } from '../cache'
import { type DomainHandle, getDomain } from '../domain'
import { mergeReply, readComments } from '../state/comments'
import { readContext } from '../state/context'
import { listDocuments } from '../state/documents'
import { refreshAuto } from '../state/handoff'
import { readSettings } from '../state/settings'
import { readJson, removeState, writeJson } from '../state/store'
import { recordRun } from '../state/usage'
import { startBridge } from './bridge'
import { buildResumePrompt, buildSystemPrompt, buildTurnPrompt } from './prompt'
import { getHarness } from './registry'

type Notify = (e: StudioEvent) => void

const runs = new Map<string, AgentRun>()
const controllers = new Map<string, AbortController>()
/** domains whose run is being SET UP — a synchronous reservation that closes the
 *  check-then-set race between isRunning() and runs.set() (which span awaits). */
const starting = new Set<string>()
/** domains whose last-run has been rehydrated from disk this process (once). */
const hydrated = new Set<string>()

const SESSION_FILE = '.cache/agent/session.json'
/** A stable pointer to the latest run, written on START and at terminal, so a fresh
 *  process can show the last run (and reconcile one orphaned by a crash). */
const LAST_RUN_FILE = '.cache/agent/last-run.json'
const runFile = (id: string) => `.cache/agent/runs/${id}.json`
const MCP_TOOLS = [
  'list_open_threads',
  'reply_to_thread',
  'resolve_thread',
  'post_progress',
  'raise_question',
]

/** The persisted conversation handle: one resumable harness session per domain,
 *  with a turn counter so the UI can show "N turns" and resume continuity. */
interface SessionState {
  harness?: string
  sessionId?: string
  turns?: number
  updatedAt?: string
}
const readSession = (root: string): SessionState => readJson<SessionState>(root, SESSION_FILE, {})

/** Persist the run to disk (best-effort). `transcript` also writes the per-id record. */
function persistRun(root: string, run: AgentRun, transcript = false): void {
  try {
    writeJson(root, LAST_RUN_FILE, run)
    if (transcript) writeJson(root, runFile(run.id), run)
  } catch {
    /* transcript is best-effort — never let it break a run */
  }
}

/** On a fresh process the in-memory run map is empty. Seed the latest run from disk
 *  so the drawer shows it after a studio restart — and if that run was still
 *  `running`/`queued`, its agent died with the old process, so reconcile it to
 *  `interrupted` (an honest terminal state) instead of a perpetual spinner. */
function hydrate(domainId: string, root: string): void {
  if (hydrated.has(domainId) || runs.has(domainId)) return
  hydrated.add(domainId)
  const last = readJson<AgentRun | null>(root, LAST_RUN_FILE, null)
  if (!last || last.domainId !== domainId) return
  if (last.status === 'running' || last.status === 'queued') {
    last.status = 'interrupted'
    last.finishedAt = last.finishedAt ?? new Date().toISOString()
    last.error =
      'the studio restarted during this turn — your conversation is preserved; submit again to continue'
    persistRun(root, last)
  }
  runs.set(domainId, last)
}

/** The resumable-conversation summary for the snapshot. */
function conversationOf(root: string): ConversationInfo {
  const s = readSession(root)
  const harness = getHarness()
  return {
    active: s.harness === harness.id && !!s.sessionId,
    turns: s.turns ?? 0,
    harness: s.harness,
  }
}

/** Open threads whose last entry is NOT the agent — the ones it owes a reply. */
function awaitingThreads(root: string): Comment[] {
  return readComments(root).comments.filter(
    (c) => c.status === 'open' && c.thread.at(-1)?.role !== 'author',
  )
}

/** Hide the machine-state reply block from the activity log (it's the wire protocol,
 *  not user-facing — the replies land in the threads). Other code fences are kept. */
function stripMachineState(text: string): string {
  return text
    .replace(/```(?:json)?\s*[\s\S]*?```/g, (m) => (/"comments"|"schemaVersion"/.test(m) ? '' : m))
    .trim()
}

export function isRunning(domainId: string): boolean {
  const s = runs.get(domainId)?.status
  return s === 'running' || s === 'queued'
}

export async function getSnapshot(domainId: string): Promise<AgentRunSnapshot> {
  const harness = getHarness()
  const handle = getDomain(domainId)
  if (handle) hydrate(domainId, handle.root)
  const conversation = handle ? conversationOf(handle.root) : { active: false, turns: 0 }
  return {
    harness: harness.id,
    available: await harness.isAvailable(),
    run: runs.get(domainId) ?? null,
    conversation,
  }
}

export function cancelRun(domainId: string): boolean {
  const c = controllers.get(domainId)
  if (!c) return false
  c.abort()
  return true
}

/** The forkable conversation session id for this domain (current harness only).
 *  Undefined when there's no conversation yet — an Ask then runs fresh (no fork).
 *  Read-only: never mutates session.json, so it's safe to call while a run is live. */
export function forkableSession(domainId: string): string | undefined {
  const handle = getDomain(domainId)
  if (!handle) return undefined
  const s = readSession(handle.root)
  return s.harness === getHarness().id ? s.sessionId : undefined
}

/** Forget the resumable conversation so the NEXT submit starts a brand-new session.
 *  Refused mid-run (the live turn owns the session). Returns false if unknown. */
export function resetConversation(domainId: string): boolean {
  const handle = getDomain(domainId)
  if (!handle) return false
  if (isRunning(domainId)) return false
  removeState(handle.root, SESSION_FILE)
  return true
}

/** The raw resumable session id (+ turn count / harness), for viewing in Settings.
 *  Read-only: safe to call while a run is live. */
export function getSessionId(domainId: string): {
  sessionId: string | null
  turns: number
  harness?: string
} {
  const handle = getDomain(domainId)
  if (!handle) return { sessionId: null, turns: 0 }
  const s = readSession(handle.root)
  return { sessionId: s.sessionId ?? null, turns: s.turns ?? 0, harness: s.harness }
}

/** Overwrite (or clear) the resumable session id by hand. Empty ⇒ forget the
 *  conversation (next submit starts fresh). Refused mid-run (the live turn owns it). */
export function setSessionId(domainId: string, sessionId: string): boolean {
  const handle = getDomain(domainId)
  if (!handle) return false
  if (isRunning(domainId)) return false
  const trimmed = sessionId.trim()
  if (!trimmed) {
    removeState(handle.root, SESSION_FILE)
    return true
  }
  const prev = readSession(handle.root)
  writeJson(handle.root, SESSION_FILE, {
    harness: prev.harness ?? getHarness().id,
    sessionId: trimmed,
    turns: prev.turns ?? 0,
    updatedAt: new Date().toISOString(),
  })
  return true
}

/** What a submit carries: an optional typed instruction, or a bare `resume` — a
 *  seamless "continue where you left off" after an interruption (no re-briefing). */
export interface SubmitOpts {
  message?: string
  resume?: boolean
}

export async function submitRun(
  handle: DomainHandle,
  notify: Notify,
  opts?: SubmitOpts,
): Promise<{ run?: AgentRun; error?: string }> {
  const domainId = handle.id
  // Reserve the slot SYNCHRONOUSLY (before any await) so two concurrent submits
  // — a double-click / retry — can't both pass the gate and start two runs.
  if (isRunning(domainId) || starting.has(domainId))
    return { error: 'an agent run is already in progress for this domain' }
  starting.add(domainId)
  try {
    return await startRun(handle, notify, opts)
  } finally {
    starting.delete(domainId)
  }
}

async function startRun(
  handle: DomainHandle,
  notify: Notify,
  opts?: SubmitOpts,
): Promise<{ run?: AgentRun; error?: string }> {
  const domainId = handle.id
  const root = handle.root

  const harness = getHarness()
  if (!(await harness.isAvailable()))
    return { error: `${harness.label} is not available on this machine` }

  const session = readSession(root)
  const resume = session.harness === harness.id ? session.sessionId : undefined
  // A bare resume only continues an EXISTING session — without one there's nothing
  // in the agent's memory to pick up, so a nudge alone would be useless. When the
  // caller asks to resume but no session survives, fall through to a normal full turn.
  const bareResume = opts?.resume === true && !!resume

  const awaiting = awaitingThreads(root)
  const msg = (opts?.message ?? '').trim()
  if (!bareResume && awaiting.length === 0 && !msg)
    return { error: 'nothing to send — type an instruction or open a thread' }

  // refresh the auto-context digests on disk first, so "read these files" holds
  await refreshAuto(handle).catch(() => {})

  const bundle = await getBundle(domainId)
  const schemaHash = bundle?.schemaHash ?? ''
  const ctx = readContext(root)
  const documents = listDocuments(root)
  const settings = readSettings(root)

  // per-run write-back bridge (token-scoped MCP tools); harmless if the harness ignores it
  const bridge = startBridge(handle, () => runs.get(domainId)?.id ?? '', notify)

  // Build the turn prompt for a given continuity. Reused when a rejected resume forces
  // a fresh restart — the header/orientation differ between "resume" and "new session".
  // A bare resume sends just the nudge (the live session still holds everything); but a
  // FRESH start (firstTurn — incl. the resume-rejected fallback) must carry full context.
  const makeTurn = (firstTurn: boolean) =>
    bareResume && !firstTurn
      ? buildResumePrompt()
      : buildTurnPrompt({
          origin: bundle?.overlay.origin ?? domainId,
          root,
          schemaHash,
          awaitingThreads: awaiting,
          userContext: ctx.user,
          autoContext: ctx.auto.filter((a) => a.includeInHandoff),
          documents,
          firstTurn,
          message: msg,
          ir: bundle?.ir ?? null,
          overlay: bundle?.overlay,
        })
  const system = buildSystemPrompt({ bridge: bridge.enabled })
  const promptSnapshot = (
    sessionId: string | undefined,
    firstTurn: boolean,
  ): AgentPromptSnapshot => ({
    createdAt: new Date().toISOString(),
    systemPrompt: system,
    turnPrompt: makeTurn(firstTurn),
    firstTurn,
    resumed: !!sessionId,
    sessionId,
    effort: settings.agentEffort,
    mcpTools: bridge.enabled ? MCP_TOOLS : [],
  })

  const run: AgentRun = {
    id: randomUUID(),
    domainId,
    harness: harness.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    summary: bareResume
      ? 'continuing after interruption'
      : msg
        ? msg.slice(0, 60) + (msg.length > 60 ? '…' : '')
        : awaiting.length === 1
          ? '1 open thread'
          : `${awaiting.length} open threads`,
    targetCommentIds: awaiting.map((c) => c.id),
    events: [],
    sessionId: resume,
    resumed: !!resume,
    prompt: promptSnapshot(resume, !resume),
  }
  runs.set(domainId, run)
  persistRun(root, run) // record on START so a crash mid-turn leaves a reconcilable trace
  const controller = new AbortController()
  controllers.set(domainId, controller)
  notify({ type: 'agent-run', domainId, run })

  const pushEvent = (e: Omit<AgentEvent, 'id' | 'ts'>) => {
    let text = e.text
    if (e.kind === 'message') {
      text = stripMachineState(text)
      if (!text) return // the message was ONLY the machine-state reply block
    }
    const ev: AgentEvent = { id: randomUUID(), ts: new Date().toISOString(), ...e, text }
    run.events.push(ev)
    notify({ type: 'agent-event', domainId, runId: run.id, event: ev })
  }
  let bridgeReplies = 0
  // commentId → texts the agent already posted LIVE this run, so the end-of-turn
  // merge can skip exactly those (and nothing else) without duplicating.
  const liveByComment = new Map<string, Set<string>>()
  bridge.onReply((commentId, text) => {
    bridgeReplies += 1
    if (!liveByComment.has(commentId)) liveByComment.set(commentId, new Set())
    liveByComment.get(commentId)!.add(text.trim())
    pushEvent({ kind: 'reply', text, commentId })
  })
  bridge.onProgress((text) => pushEvent({ kind: 'status', text }))

  // fire-and-forget; the HTTP response returns the running run immediately
  void (async () => {
    try {
      // run one harness turn with the given continuity
      const runTurn = (sessionId: string | undefined, firstTurn: boolean) => {
        const prompt = promptSnapshot(sessionId, firstTurn)
        run.prompt = prompt
        notify({ type: 'agent-run', domainId, run })
        return harness.run({
          root,
          prompt: prompt.turnPrompt,
          appendSystemPrompt: prompt.systemPrompt,
          sessionId,
          effort: settings.agentEffort,
          mcpConfigPath: bridge.mcpConfigPath,
          signal: controller.signal,
          onEvent: pushEvent,
        })
      }

      let result = await runTurn(resume, !resume)
      let convoTurns = resume ? (session.turns ?? 0) : 0

      // Auto-recover a rejected resume: the stored session is gone on the harness side
      // (pruned/expired). Drop it and transparently re-run the SAME work as a NEW
      // conversation so the user's turn still lands instead of dead-ending on a stale id.
      if (resume && result.resumeRejected && !controller.signal.aborted) {
        removeState(root, SESSION_FILE)
        convoTurns = 0
        run.sessionId = undefined
        run.resumed = false
        pushEvent({
          kind: 'status',
          text: 'previous conversation was no longer available — started a new one',
        })
        result = await runTurn(undefined, true)
      }

      run.sessionId = result.sessionId ?? run.sessionId
      run.costUsd = result.costUsd
      run.tokens = result.tokens
      run.numTurns = result.numTurns
      run.liveReplies = bridgeReplies

      if (bridgeReplies > 0 && !controller.signal.aborted)
        pushEvent({
          kind: 'status',
          text: `replied to ${bridgeReplies} thread${bridgeReplies === 1 ? '' : 's'} live`,
        })

      // Merge the agent's end-of-turn machine-state block. ALWAYS run it on a clean
      // turn (so threads answered only in the block still land); dedupe is scoped to
      // this run's live replies. SKIP it when the turn was canceled (re-checked LIVE,
      // not a stale snapshot) or the harness errored — neither should apply a
      // partial/untrusted answer or close threads.
      let replyError: string | undefined
      if (
        !controller.signal.aborted &&
        !result.isError &&
        result.finalText &&
        result.finalText.trim()
      ) {
        try {
          const merged = mergeReply(root, schemaHash, result.finalText, {
            skipByComment: liveByComment,
          })
          run.merge = merged
          if (merged.merged || merged.closed)
            pushEvent({
              kind: 'status',
              text: `merged ${merged.merged} repl${merged.merged === 1 ? 'y' : 'ies'}, closed ${merged.closed}`,
            })
          notify({ type: 'comments', domainId })
        } catch (e: any) {
          // a MALFORMED block is real data loss → fail the run so it's visible; an
          // ABSENT block is benign (the agent used the bridge or had nothing to say).
          if (/```json/i.test(result.finalText)) {
            replyError = `agent reply block was malformed JSON — reply not merged (${String(e?.message ?? e).slice(0, 80)})`
            pushEvent({ kind: 'error', text: replyError })
          } else if (bridgeReplies === 0) {
            pushEvent({ kind: 'status', text: 'no machine-state reply block in the final message' })
          }
        }
      }

      if (controller.signal.aborted) run.status = 'canceled'
      else if (result.isError) {
        run.status = 'failed'
        run.error = result.errorMessage
        pushEvent({ kind: 'error', text: result.errorMessage ?? 'agent error' })
      } else if (replyError) {
        run.status = 'failed'
        run.error = replyError
      } else run.status = 'succeeded'

      // Session persistence. Keep the conversation across an UNRELATED transient
      // failure (rate limit, a typecheck slip, a cancel) so the user can just resume —
      // only a genuinely rejected resume drops the id, and that was already handled
      // above (with a fresh restart). On success, persist the id and bump the turn
      // count; otherwise leave the stored session exactly as it was.
      if (run.status === 'succeeded' && result.sessionId)
        writeJson(root, SESSION_FILE, {
          harness: harness.id,
          sessionId: result.sessionId,
          turns: convoTurns + 1,
          updatedAt: new Date().toISOString(),
        })
    } catch (e: any) {
      run.status = controller.signal.aborted ? 'canceled' : 'failed'
      run.error = String(e?.message ?? e)
      pushEvent({ kind: 'error', text: run.error })
      // Keep the stored session — an unexpected throw is not proof the conversation is
      // dead. The next submit resumes it; a genuinely dead id self-heals via the
      // resumeRejected → fresh-restart path above.
    } finally {
      run.finishedAt = new Date().toISOString()
      // only clear the controller if it is still OURS (defensive against overwrite)
      if (controllers.get(domainId) === controller) controllers.delete(domainId)
      bridge.dispose()
      recordRun(root, run) // fold this turn's tokens/cost into the domain's running total
      persistRun(root, run, true) // final state → both the latest-run pointer and the transcript
      notify({ type: 'agent-run', domainId, run })
      notify({ type: 'comments', domainId })
    }
  })()

  return { run }
}
