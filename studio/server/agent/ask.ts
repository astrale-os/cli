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
import type { AskResult } from './types'

import { getBundle } from '../cache'
import { resolveHarnessEnv } from '../state/harness-gateway'
import { readSettings } from '../state/settings'
import { buildAskPrompt, buildAskSystemPrompt } from './prompt'
import { getHarness } from './registry'
import { forkableSession } from './runner'

export interface AskRequest {
  anchor?: AnchorRef
  excerpt?: string
  question: string
}

export async function runAsk(
  handle: DomainHandle,
  body: AskRequest,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<AskResult> {
  const harness = getHarness()
  if (!harness.ask)
    return {
      text: '',
      isError: true,
      errorMessage: `${harness.label} does not support side questions`,
    }
  const question = String(body?.question ?? '').trim()
  if (!question) return { text: '', isError: true, errorMessage: 'question is required' }

  const ref = body.anchor?.ref ?? '(no target)'
  const bundle = await getBundle(handle.id)
  const prompt = buildAskPrompt({
    anchorRef: ref,
    excerpt: body.excerpt || ref,
    question,
    ir: bundle?.ir ?? null,
    overlay: bundle?.overlay,
  })
  const settings = readSettings(handle.root)
  const envResult = await resolveHarnessEnv(handle.root)
  if (!envResult.ok)
    return {
      text: '',
      isError: true,
      errorMessage: `model gateway auth failed — ${envResult.error}`,
    }

  return harness.ask({
    root: handle.root,
    prompt,
    appendSystemPrompt: buildAskSystemPrompt(),
    sessionId: forkableSession(handle.id), // fork the live conversation (undefined ⇒ fresh)
    effort: settings.agentEffort,
    env: envResult.env,
    signal,
    onDelta,
  })
}
