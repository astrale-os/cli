/**
 * Studio View sessions: prepare a View on the instance shown to the user, launch it
 * through the CLI-owned `astrale view` session, and hand it back when its page closes.
 *
 * Studio opens Views only on an instance its user owns in Admin, and opens them as
 * that owner: the session resolves the View as the instance root and runs it as
 * Root until the page picks another Identity, exactly like the Admin back-office.
 */
import { randomBytes } from 'node:crypto'

import type { ViewInfo, ViewRuntime, ViewSessionResult } from '../../shared/contracts/schema'

import {
  openStudioViewSession,
  releaseStudioViewSession,
  studioActiveInstanceName,
  studioInstanceOwnership,
} from '../../../src/commands/studio-views'
import { notOwnerError } from '../../../src/lib/admin/ownership'
import { viewPathOf } from '../../../src/lib/view/resolve'
import { studioCliCommand } from '../cli'

const PREPARATION_TTL_MS = 10 * 60_000
const MAX_PREPARATIONS = 128

/**
 * Idle budget for a Studio-opened session. Studio releases a session as soon as
 * its dialog closes, so this is only the net for a page that stopped reporting
 * without leaving: a tab the browser froze in the background, a machine that
 * slept. Hours, not minutes, because the tab an operator popped a View out into
 * has to survive an afternoon behind other windows.
 */
const STUDIO_VIEW_IDLE_MS = 8 * 60 * 60_000

/** The CLI owners a View session delegates to; tests stand in for Admin, the instance and the server. */
export interface ViewSessionDependencies {
  activeInstance: typeof studioActiveInstanceName
  ownership: typeof studioInstanceOwnership
  open: typeof openStudioViewSession
}

const defaults: ViewSessionDependencies = {
  activeInstance: studioActiveInstanceName,
  ownership: studioInstanceOwnership,
  open: openStudioViewSession,
}

interface ViewPreparation {
  id: string
  root: string
  origin: string
  slug: string
  instance: string | null
  expiresAt: number
}

const preparations = new Map<string, ViewPreparation>()

function prunePreparations(now: number): void {
  for (const [id, preparation] of preparations) {
    if (preparation.expiresAt <= now) preparations.delete(id)
  }
}

/** Every View belongs to its Domain: preparing one only pins the instance it will read. */
export async function getViewRuntime(
  root: string,
  origin: string,
  view: ViewInfo,
  dependencies: Partial<ViewSessionDependencies> = {},
): Promise<ViewRuntime> {
  const instance = await (dependencies.activeInstance ?? defaults.activeInstance)()
  const now = Date.now()
  prunePreparations(now)
  const id = randomBytes(12).toString('hex')
  preparations.set(id, {
    id,
    root,
    origin,
    slug: view.slug,
    instance,
    expiresAt: now + PREPARATION_TTL_MS,
  })
  while (preparations.size > MAX_PREPARATIONS) {
    const oldest = preparations.keys().next().value
    if (typeof oldest !== 'string') break
    preparations.delete(oldest)
  }
  return { slug: view.slug, preparationId: id, instance }
}

/** A preparation made for this exact workspace, Domain and View, while it still stands. */
function readPreparation(
  id: string,
  expected: Pick<ViewPreparation, 'root' | 'origin' | 'slug'>,
): ViewPreparation | null {
  prunePreparations(Date.now())
  const preparation = preparations.get(id)
  return preparation &&
    preparation.root === expected.root &&
    preparation.origin === expected.origin &&
    preparation.slug === expected.slug
    ? preparation
    : null
}

export async function launchViewSession(
  root: string,
  origin: string,
  view: ViewInfo,
  request: { preparationId?: unknown },
  timeoutMs: number,
  dependencies: Partial<ViewSessionDependencies> = {},
): Promise<ViewSessionResult> {
  const preparationId =
    typeof request.preparationId === 'string' ? request.preparationId.trim() : ''
  const preparation = preparationId
    ? readPreparation(preparationId, { root, origin, slug: view.slug })
    : null
  if (!preparation) {
    return {
      status: 'unavailable',
      reason: 'The view preparation expired. Refresh the view and try again.',
    }
  }

  const instance = preparation.instance
  if (!instance) return { status: 'unavailable', reason: 'No active Astrale instance.' }
  if ((await (dependencies.activeInstance ?? defaults.activeInstance)()) !== instance) {
    return {
      status: 'unavailable',
      reason: 'The active instance changed. Refresh the view and try again.',
    }
  }

  const sessionTimeoutMs = Math.max(20_000, timeoutMs + 12_000)
  // Only an instance its user owns in Admin: an instance set active from a
  // terminal is refused here, whatever else Studio still does with it. Admin
  // decides again on every root renewal, so this is the explanation, not the gate.
  let owner: string
  try {
    const ownership = await (dependencies.ownership ?? defaults.ownership)(
      instance,
      sessionTimeoutMs,
    )
    if (ownership.status !== 'owned') {
      return { status: 'unavailable', reason: notOwnerError(ownership).message }
    }
    owner = ownership.instance
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `Studio could not verify in Admin that you own this instance: ${
        error instanceof Error && error.message.trim() ? error.message : String(error)
      }`,
    }
  }

  try {
    // The View opens as the owner: resolved as the instance root and run as
    // Root, whatever identity this instance is bound to. The page lists the
    // instance's Identities, read as root, and switches between them; the root
    // and impersonation tokens behind that list never leave the session server.
    const session = await (dependencies.open ?? defaults.open)({
      viewPath: viewPathOf(origin, view.slug),
      instance,
      owner,
      idleMs: STUDIO_VIEW_IDLE_MS,
      timeoutMs: sessionTimeoutMs,
      serveRuntime: studioViewServeRuntime(),
    })
    const viewUrl = session.view?.route?.href
    if (!session.id || !session.pageUrl || !viewUrl) {
      return { status: 'unavailable', reason: '`astrale view` returned an invalid session.' }
    }
    return { status: 'ready', sessionId: session.id, pageUrl: session.pageUrl, viewUrl }
  } catch (error) {
    return {
      status: 'unavailable',
      reason:
        error instanceof Error && error.message.trim()
          ? error.message
          : '`astrale view` could not start the preview session.',
    }
  }
}

/**
 * Hand a session back on behalf of one Studio page. Never a close: the operator
 * may have opened this View in a tab of their own, and that tab holds the
 * session on its own account.
 */
export async function releaseViewSession(
  sessionId: string,
  page: string | undefined,
): Promise<{ ok: true }> {
  if (!/^v-[0-9a-f]+$/.test(sessionId)) return { ok: true }
  // The page id is the browser's, so it is bounded here rather than in the
  // CLI-owned session it reaches. Releasing without one still hands the session
  // back; only its own page stays attached until it goes quiet.
  const named = page !== undefined && /^[A-Za-z0-9-]{1,64}$/.test(page) ? page : undefined
  await releaseStudioViewSession(sessionId, named)
  return { ok: true }
}

function studioViewServeRuntime(): { file: string; args: string[] } {
  const [file, ...args] = studioCliCommand([])
  if (!file) throw new Error('The Studio CLI runtime is unavailable.')
  return { file, args }
}
