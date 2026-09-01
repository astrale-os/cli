import { randomUUID } from 'node:crypto'

import type { AgentEvent, StudioEvent } from '../../../shared/types'
import type { PreparedRun } from './preparation'

import { mergeReply } from '../../state/comments'
import { chatExists, clearChatSession, recordChatTurn } from '../chats'
import { emitStudioEvent } from '../notify'
import { releaseController } from './live-state'
import { persistRun } from './transcript'
import { recordRun } from './usage'

function stripMachineState(text: string): string {
  return text
    .replace(/```(?:json)?\s*[\s\S]*?```/g, (block) =>
      /"comments"|"schemaVersion"/.test(block) ? '' : block,
    )
    .trim()
}

/** Execute and settle one prepared agent run. */
export async function completeRun(
  prepared: PreparedRun,
  controller: AbortController,
  notify: (event: StudioEvent) => void,
): Promise<void> {
  const {
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
  } = prepared
  const pushEvent = (event: Omit<AgentEvent, 'id' | 'ts'>) => {
    let text = event.text
    if (event.kind === 'message') {
      text = stripMachineState(text)
      if (!text) return
    }
    const stored: AgentEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      ...event,
      text,
    }
    run.events.push(stored)
    emitStudioEvent(notify, {
      type: 'agent-event',
      domainId,
      chatId: chat.id,
      runId: run.id,
      event: stored,
    })
  }

  let bridgeReplies = 0
  const liveByComment = new Map<string, Set<string>>()
  bridge.onReply((commentId, text) => {
    bridgeReplies += 1
    if (!liveByComment.has(commentId)) liveByComment.set(commentId, new Set())
    liveByComment.get(commentId)!.add(text.trim())
    pushEvent({ kind: 'reply', text, commentId })
  })
  bridge.onProgress((text) => pushEvent({ kind: 'status', text }))

  try {
    const runTurn = (sessionId: string | undefined, firstTurn: boolean) => {
      const prompt = promptSnapshot(sessionId, firstTurn)
      run.prompt = prompt
      emitStudioEvent(notify, { type: 'agent-run', domainId, chatId: chat.id, run })
      return harness.run({
        root,
        prompt: prompt.turnPrompt,
        appendSystemPrompt: prompt.systemPrompt,
        sessionId,
        model,
        effort,
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
      clearChatSession(root, chat.id)
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
    if (
      !controller.signal.aborted &&
      !result.isError &&
      result.finalText &&
      result.finalText.trim()
    ) {
      try {
        const merged = mergeReply(root, renderFingerprint, result.finalText, {
          skipByComment: liveByComment,
        })
        run.merge = merged
        if (merged.merged || merged.closed)
          pushEvent({
            kind: 'status',
            text: `merged ${merged.merged} repl${merged.merged === 1 ? 'y' : 'ies'}, closed ${merged.closed}`,
          })
        emitStudioEvent(notify, { type: 'comments', domainId })
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
      recordChatTurn(root, chat.id, {
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
    recordRun(root, run)
    // The transcript did not: a turn settling after its tab was closed would
    // otherwise recreate the files `closeChat` just removed.
    if (chatExists(root, chat.id)) persistRun(root, run, true)
    emitStudioEvent(notify, { type: 'agent-run', domainId, chatId: chat.id, run })
    emitStudioEvent(notify, { type: 'comments', domainId })
  }
}
