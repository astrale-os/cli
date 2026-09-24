import { randomUUID } from 'node:crypto'

import type { AgentEvent, MergeResult } from '../../../shared/types'
import type { AgentStreamEvent } from '../harness/adapter'
import type { Notify } from '../notify'
import type { PreparedRun } from './preparation'

import { mergeParsedReply, parseReplyBlock } from '../../state/comments'
import { chatExists, clearChatSession, recordChatTurn } from '../chats'
import { emitStudioEvent } from '../notify'
import { releaseController } from './live-state'
import { recordToolCall, settleToolCalls } from './tool-calls'
import { persistRun } from './transcript'
import { recordRun } from './usage'

function stripMachineState(text: string): string {
  return text
    .replace(/```(?:json)?\s*[\s\S]*?```/g, (block) =>
      /"comments"|"schemaVersion"/.test(block) ? '' : block,
    )
    .trim()
}

/**
 * Merge the agent's final machine-state block into every domain it briefed.
 *
 * The block is parsed once; each domain keeps the entries whose ids it holds. An id
 * no domain knows is unknown for the turn, not for each domain that failed to find it.
 */
function mergeAcrossDomains(
  prepared: PreparedRun,
  finalText: string,
  skipByComment: Map<string, Set<string>>,
): { result: MergeResult; touched: string[] } {
  const parsed = parseReplyBlock(finalText)
  const result: MergeResult = { merged: 0, closed: 0, unknownIds: [], schemaMismatch: false }
  const touched: string[] = []
  const known = new Set<string>()
  let unknown: string[] | undefined
  for (const { handle, renderFingerprint } of prepared.briefed) {
    const merged = mergeParsedReply(handle.root, renderFingerprint, parsed, { skipByComment })
    result.merged += merged.merged
    result.closed += merged.closed
    if (merged.merged || merged.closed) touched.push(handle.id)
    const unknownHere = new Set(merged.unknownIds)
    for (const comment of parsed.comments ?? [])
      if (comment.id && !unknownHere.has(comment.id)) known.add(comment.id)
    unknown = merged.unknownIds
    if (merged.pastedSchemaVersion !== undefined)
      result.pastedSchemaVersion = merged.pastedSchemaVersion
  }
  result.unknownIds = (unknown ?? []).filter((id) => !known.has(id))
  // A block that spans several domains carries no fingerprint; one domain's block does,
  // and only that one can disagree with the render it was given.
  result.schemaMismatch =
    prepared.briefed.length === 1 &&
    !!result.pastedSchemaVersion &&
    result.pastedSchemaVersion !== prepared.briefed[0]!.renderFingerprint
  return { result, touched }
}

/** Execute and settle one prepared agent run. */
export async function completeRun(
  prepared: PreparedRun,
  controller: AbortController,
  notify: Notify,
): Promise<void> {
  const {
    workspace,
    chat,
    harness,
    settings,
    resume,
    model,
    effort,
    fastMode,
    harnessEnv,
    bridge,
    run,
    images,
    promptSnapshot,
  } = prepared
  const stateRoot = workspace.stateRoot
  const emitEvent = (event: AgentEvent) =>
    emitStudioEvent(notify, { type: 'agent-event', chatId: chat.id, runId: run.id, event })
  // where each tool call's step sits in the transcript, by the harness's call id
  const callSteps = new Map<string, number>()
  const pushEvent = ({
    call,
    ...event
  }: Omit<AgentEvent, 'id' | 'ts' | 'status' | 'revision'> & Pick<AgentStreamEvent, 'call'>) => {
    let text = event.text
    if (event.kind === 'message') {
      text = stripMachineState(text)
      if (!text) return
    }
    const status = call?.detail.status
    const step = call ? callSteps.get(call.id) : undefined
    const known = step === undefined ? undefined : run.events[step]
    if (call && step !== undefined && known) {
      // a call reported again is the same step, now knowing more: it keeps its
      // place and its id, and the reader holding its details open reads them again
      const updated: AgentEvent = {
        ...known,
        ...event,
        text,
        ...(status ? { status } : {}),
        revision: (known.revision ?? 0) + 1,
      }
      run.events[step] = updated
      recordToolCall(run, updated.id, call.detail)
      emitEvent(updated)
      return
    }
    const stored: AgentEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      ...event,
      text,
      ...(status ? { status } : {}),
      ...(call ? { revision: 1 } : {}),
    }
    if (call) {
      callSteps.set(call.id, run.events.length)
      recordToolCall(run, stored.id, call.detail)
    }
    run.events.push(stored)
    emitEvent(stored)
  }

  let bridgeReplies = 0
  const liveByComment = new Map<string, Set<string>>()
  bridge.onReply((commentId, text) => {
    bridgeReplies += 1
    const texts = liveByComment.get(commentId) ?? new Set<string>()
    texts.add(text.trim())
    liveByComment.set(commentId, texts)
    pushEvent({ kind: 'reply', text, commentId })
  })
  bridge.onProgress((text) => pushEvent({ kind: 'status', text }))

  try {
    const runTurn = (sessionId: string | undefined, firstTurn: boolean) => {
      const prompt = promptSnapshot(sessionId, firstTurn)
      run.prompt = prompt
      emitStudioEvent(notify, { type: 'agent-run', chatId: chat.id, run })
      return harness.run({
        root: workspace.root,
        prompt: prompt.turnPrompt,
        images,
        appendSystemPrompt: prompt.systemPrompt,
        sessionId,
        model,
        effort,
        fastMode,
        access: settings.agentAccess,
        mcpServers: bridge.mcpServers,
        env: harnessEnv,
        signal: controller.signal,
        onEvent: pushEvent,
      })
    }

    const resumeEventStart = run.events.length
    const resumeBridgeReplies = bridgeReplies
    let result = await runTurn(resume, !resume)
    let conversationTurns = resume ? chat.turns : 0
    if (resume && result.resumeRejected && !controller.signal.aborted) {
      clearChatSession(stateRoot, chat.id)
      conversationTurns = 0
      run.sessionId = undefined
      run.resumed = false
      const observableActivity =
        bridgeReplies > resumeBridgeReplies ||
        run.events
          .slice(resumeEventStart)
          .some(
            (event) => event.kind === 'message' || event.kind === 'tool' || event.kind === 'reply',
          )
      if (observableActivity) {
        result = {
          ...result,
          sessionId: undefined,
          isError: true,
          errorMessage:
            'the previous conversation was rejected after observable activity — Studio did not retry automatically to avoid duplicating work',
        }
        pushEvent({
          kind: 'status',
          text: 'resume was not retried because the rejected attempt had already produced observable activity',
        })
      } else {
        pushEvent({
          kind: 'status',
          text: 'previous conversation was no longer available — started a new one',
        })
        result = await runTurn(undefined, true)
      }
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

    let replyError: string | undefined
    if (!controller.signal.aborted && !result.isError && result.finalText?.trim()) {
      try {
        const { result: merged, touched } = mergeAcrossDomains(
          prepared,
          result.finalText,
          liveByComment,
        )
        run.merge = merged
        if (merged.merged || merged.closed)
          pushEvent({
            kind: 'status',
            text: `merged ${merged.merged} repl${merged.merged === 1 ? 'y' : 'ies'}, closed ${merged.closed}`,
          })
        for (const domainId of touched) emitStudioEvent(notify, { type: 'comments', domainId })
      } catch (error: any) {
        if (/```json/i.test(result.finalText)) {
          replyError = `agent reply block was malformed JSON — reply not merged (${String(error?.message ?? error).slice(0, 80)})`
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

    if (run.status === 'succeeded' && result.sessionId) {
      recordChatTurn(stateRoot, chat.id, {
        sessionId: result.sessionId,
        turns: conversationTurns + 1,
      })
    }
  } catch (error: any) {
    run.status = controller.signal.aborted ? 'canceled' : 'failed'
    run.error = String(error?.message ?? error)
    pushEvent({ kind: 'error', text: run.error })
  } finally {
    run.finishedAt = new Date().toISOString()
    releaseController(chat.id, controller)
    bridge.dispose()
    // The spend happened whatever the user did with the tab meanwhile.
    recordRun(stateRoot, run)
    // The transcript did not: a turn settling after its tab was closed would
    // otherwise recreate the files `closeChat` just removed.
    const kept = chatExists(stateRoot, chat.id)
    if (kept) persistRun(stateRoot, run, true)
    // before the frame below: a reader it prompts to open a step finds it on disk
    settleToolCalls(stateRoot, run.id, kept)
    emitStudioEvent(notify, { type: 'agent-run', chatId: chat.id, run })
    // The agent may have edited or answered anywhere in the workspace: every domain's
    // threads are worth a second look now.
    for (const handle of workspace.domains)
      emitStudioEvent(notify, { type: 'comments', domainId: handle.id })
  }
}
