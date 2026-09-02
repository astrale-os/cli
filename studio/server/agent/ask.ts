/**
 * agent/ask.ts — the "side question" channel. A quick, EPHEMERAL aside about one
 * element: it FORKS the workspace's live conversation (so it inherits the full context
 * the main loop built up) but writes nothing back to the parent transcript — the
 * main thread, its session, and every comments.json are all untouched. Streams the
 * answer; nothing is persisted.
 *
 * It deliberately bypasses the one-run-per-chat lock (the fork is isolated from the
 * parent conversation) so you can ask while a main agent turn is running.
 */
import type { AnchorRef } from '../../shared/types'
import type { AskResult } from './harness/adapter'
import type { AgentWorkspace } from './workspace'

import { getBundle } from '../cache'
import { resolveChat } from './chats'
import { getHarnessById } from './harness/registry'
import { getHarness, resolveHarnessConfiguration } from './harness/selection'
import { buildAskPrompt, buildAskSystemPrompt } from './prompts/ask'
import { studioSessionId } from './telemetry'
import { domainOrigin, domainRelativePath } from './workspace'

export interface AskRequest {
  anchor?: AnchorRef
  excerpt?: string
  question: string
  /** the domain the element belongs to — its schema is what the target is described from */
  domainId?: string
  /** the tab whose conversation to fork; absent ⇒ the one the user is looking at */
  chatId?: string
}

export async function runAsk(
  workspace: AgentWorkspace,
  body: AskRequest,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<AskResult> {
  const question = String(body?.question ?? '').trim()
  if (!question) return { text: '', isError: true, errorMessage: 'question is required' }
  // The fork belongs to ONE chat: its harness, its model, its session id.
  const chat = resolveChat(
    workspace.stateRoot,
    getHarness().id,
    body.chatId,
    { workspace: workspace.root, origins: workspace.domains.map(domainOrigin) },
    workspace.uiRoot,
  )
  const resolved = await resolveHarnessConfiguration(
    chat ? getHarnessById(chat.harness) : undefined,
    {
      ...(chat?.model ? { model: chat.model } : {}),
      ...(chat?.effort ? { effort: chat.effort } : {}),
    },
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
  const handle = body.domainId
    ? workspace.domains.find((candidate) => candidate.id === body.domainId)
    : undefined
  const bundle = handle ? await getBundle(handle.id) : null
  const prompt = buildAskPrompt({
    anchorRef: ref,
    excerpt: body.excerpt || ref,
    question,
    ir: bundle?.ir ?? null,
    overlay: bundle?.overlay,
    ...(handle
      ? { domain: { origin: domainOrigin(handle), path: domainRelativePath(workspace, handle) } }
      : {}),
  })
  return harness.ask({
    root: workspace.root,
    prompt,
    appendSystemPrompt: buildAskSystemPrompt(),
    ...(chat?.sessionId ? { sessionId: chat.sessionId } : {}),
    model,
    effort,
    access: resolved.configuration.settings.agentAccess,
    env: { ...env, ASTRALE_SESSION: studioSessionId(workspace.key) },
    signal,
    onDelta,
  })
}
