/**
 * agent/ask.ts — the "side question" channel. A quick, EPHEMERAL aside about one
 * element: it FORKS the domain's live conversation (so it inherits the full context
 * the main loop built up) but writes nothing back to the parent transcript — the
 * main thread, its session, and comments.json are all untouched. Streams the
 * answer; nothing is persisted.
 *
 * It deliberately bypasses the single-run-per-domain lock (the fork is isolated
 * from the parent conversation) so you can ask while a main agent turn is running.
 */
import type { AnchorRef } from '../../shared/types'
import type { DomainHandle } from '../domain'
import type { AskResult } from './harness/adapter'

import { getBundle } from '../cache'
import { resolveChat } from './chats'
import { getHarnessById } from './harness/registry'
import { getHarness, resolveHarnessConfiguration } from './harness/selection'
import { buildAskPrompt, buildAskSystemPrompt } from './prompts/ask'
import { studioSessionId } from './telemetry'

export interface AskRequest {
  anchor?: AnchorRef
  excerpt?: string
  question: string
  /** the tab whose conversation to fork; absent ⇒ the one the user is looking at */
  chatId?: string
}

export async function runAsk(
  handle: DomainHandle,
  body: AskRequest,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<AskResult> {
  const question = String(body?.question ?? '').trim()
  if (!question) return { text: '', isError: true, errorMessage: 'question is required' }
  // The fork belongs to ONE chat: its harness, its model, its session id.
  const chat = resolveChat(handle.root, getHarness(handle.root).id, body.chatId)
  const resolved = await resolveHarnessConfiguration(
    handle.root,
    chat ? getHarnessById(chat.harness) : undefined,
    chat?.model,
  )
  if (!resolved.ok)
    return {
      text: '',
      isError: true,
      errorMessage: `model gateway auth failed — ${resolved.error}`,
    }
  const { harness, model, effort, env } = resolved.configuration
  if (!harness.ask)
    return {
      text: '',
      isError: true,
      errorMessage: `${harness.label} does not support side questions`,
    }

  const ref = body.anchor?.ref ?? '(no target)'
  const bundle = await getBundle(handle.id)
  const prompt = buildAskPrompt({
    anchorRef: ref,
    excerpt: body.excerpt || ref,
    question,
    ir: bundle?.ir ?? null,
    overlay: bundle?.overlay,
  })
  return harness.ask({
    root: handle.root,
    prompt,
    appendSystemPrompt: buildAskSystemPrompt(),
    ...(chat?.sessionId ? { sessionId: chat.sessionId } : {}),
    model,
    effort,
    access: resolved.configuration.settings.agentAccess,
    env: { ...env, ASTRALE_SESSION: studioSessionId(handle.id) },
    signal,
    onDelta,
  })
}
