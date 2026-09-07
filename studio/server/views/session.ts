import type {
  StudioSchemaBundle,
  ViewInfo,
  ViewSessionResult,
  ViewTargetCandidate,
} from '../../shared/types'

import {
  closeStudioViewSession,
  openStudioViewSession,
  studioViewIdentityNames,
} from '../../../src/lib/view/studio-runtime'
import { studioCliCommand } from '../cli'
import { activeInstanceName } from '../instances/active'
import { readViewPreparation } from './preparation'
import { rememberTarget } from './selection-repository'

export { conciseCliFailure } from '../cli'

interface ViewSessionDependencies {
  activeInstance: typeof activeInstanceName
  close: typeof closeStudioViewSession
  open: typeof openStudioViewSession
  readPreparation: typeof readViewPreparation
  identityNames: typeof studioViewIdentityNames
  serveRuntime: typeof studioViewServeRuntime
}

interface OpenedViewPayload {
  session?: {
    id?: string
    pageUrl?: string
    view?: { route?: { href?: string } }
  }
}

export function readyViewSession(
  opened: OpenedViewPayload | null,
  target: ViewTargetCandidate | null,
): Extract<ViewSessionResult, { status: 'ready' }> | null {
  const session = opened?.session
  const viewUrl = session?.view?.route?.href
  if (!session?.id || !session.pageUrl || !viewUrl) return null
  return {
    status: 'ready',
    sessionId: session.id,
    pageUrl: session.pageUrl,
    viewUrl,
    target,
  }
}

export async function launchViewSession(
  root: string,
  origin: string,
  view: ViewInfo,
  _bundle: StudioSchemaBundle | null,
  request: { preparationId?: unknown; targetId?: unknown },
  timeoutMs: number,
  dependencies: Partial<ViewSessionDependencies> = {},
): Promise<ViewSessionResult> {
  const preparationId =
    typeof request.preparationId === 'string' ? request.preparationId.trim() : ''
  const readPreparation = dependencies.readPreparation ?? readViewPreparation
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
  const currentInstance = await (dependencies.activeInstance ?? activeInstanceName)()
  if (currentInstance !== instance) {
    return {
      status: 'unavailable',
      reason: 'The active instance changed. Refresh the view and try again.',
    }
  }

  let target: ViewTargetCandidate | null = null
  if (preparation.targetRequired) {
    const targetId = typeof request.targetId === 'string' ? request.targetId.trim() : ''
    if (!targetId) return { status: 'unavailable', reason: 'Select a target before opening.' }
    const targets = preparation.targets
    if (targets.status !== 'available') {
      return { status: 'unavailable', reason: targets.reason ?? 'Targets could not be queried.' }
    }
    target = targets.items.find((item) => item.id === targetId) ?? null
    if (!target) {
      return {
        status: 'unavailable',
        reason: 'That target no longer exists or is no longer visible. Choose another target.',
      }
    }
  }

  let opened: OpenedViewPayload | null = null
  try {
    // Studio is a local operator workbench. Snapshot names only; the CLI host
    // retains credentials and verifies the selected identity against this Kernel.
    const identities = await (dependencies.identityNames ?? studioViewIdentityNames)()
    opened = {
      session: await (dependencies.open ?? openStudioViewSession)({
        viewPath: `/:${assertOrigin(origin)}:view.${assertViewSlug(view.slug)}`,
        ...(target ? { targetRef: target.ref } : {}),
        instance,
        allowIdentity: identities,
        timeoutMs: Math.max(20_000, timeoutMs + 12_000),
        serveRuntime: (dependencies.serveRuntime ?? studioViewServeRuntime)(),
      }),
    }
  } catch (error) {
    return {
      status: 'unavailable',
      reason:
        error instanceof Error && error.message.trim()
          ? error.message
          : '`astrale view` could not start the preview session.',
    }
  }
  const session = readyViewSession(opened, target)
  if (!session) {
    return { status: 'unavailable', reason: '`astrale view` returned an invalid session.' }
  }

  if (target) rememberTarget(root, instance, view.slug, target)
  return session
}

export async function closeViewSession(
  sessionId: string,
  dependencies: Pick<Partial<ViewSessionDependencies>, 'close'> = {},
): Promise<{ ok: true }> {
  if (!/^v-[0-9a-f]+$/.test(sessionId)) return { ok: true }
  await (dependencies.close ?? closeStudioViewSession)(sessionId)
  return { ok: true }
}

function assertOrigin(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(value)) throw new Error(`Invalid domain origin: ${value}`)
  return value
}

function assertViewSlug(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`Invalid view slug: ${value}`)
  return value
}

function studioViewServeRuntime(): { file: string; args: string[] } {
  const [file, ...args] = studioCliCommand([])
  if (!file) throw new Error('The Studio CLI runtime is unavailable.')
  return { file, args }
}
