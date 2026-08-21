import type {
  StudioSchemaBundle,
  ViewInfo,
  ViewSessionResult,
  ViewTargetCandidate,
} from '../../shared/types'
import type { StudioCliDecoder } from '../cli'

import { decodeJsonObject, runStudioCliJson } from '../cli'
import { activeInstanceName } from '../instances/active'
import { rememberTarget } from './selection-repository'
import { listViewTargets, viewDefinitionBindings } from './target'

export { conciseCliFailure } from '../cli'

interface AstraleResult<T> {
  ok: boolean
  data: T | null
  detail: string
}

let viewSessionCommandTail: Promise<void> = Promise.resolve()

export function viewSessionArgs(
  origin: string,
  slug: string,
  instance: string,
  targetRef?: string,
): string[] {
  const args = ['view', `/:${assertOrigin(origin)}:view.${assertViewSlug(slug)}`]
  if (targetRef) args.push('--target', targetRef)
  args.push('--no-open', '--json', '-i', instance)
  return args
}

interface OpenedViewPayload {
  session?: {
    id?: string
    pageUrl?: string
    view?: { route?: { href?: string } }
  }
}

function decodeOpenedViewPayload(value: unknown): OpenedViewPayload | null {
  const payload = decodeJsonObject(value)
  if (!payload) return null
  const session = decodeJsonObject(payload.session)
  if (!session) return null
  const view = decodeJsonObject(session.view)
  const route = decodeJsonObject(view?.route)
  if (
    typeof session.id !== 'string' ||
    typeof session.pageUrl !== 'string' ||
    typeof route?.href !== 'string'
  ) {
    return null
  }
  return {
    session: {
      id: session.id,
      pageUrl: session.pageUrl,
      view: { route: { href: route.href } },
    },
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
  bundle: StudioSchemaBundle | null,
  request: { targetId?: unknown },
  timeoutMs: number,
): Promise<ViewSessionResult> {
  const instance = await activeInstanceName()
  if (!instance) return { status: 'unavailable', reason: 'No active Astrale instance.' }

  let target: ViewTargetCandidate | null = null
  if (viewDefinitionBindings(origin, view, bundle).length > 0) {
    const targetId = typeof request.targetId === 'string' ? request.targetId.trim() : ''
    if (!targetId) return { status: 'unavailable', reason: 'Select a target before opening.' }
    const targets = await listViewTargets(root, origin, view, bundle, instance, timeoutMs)
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

  const opened = await runViewSessionCommand<OpenedViewPayload>(
    viewSessionArgs(origin, view.slug, instance, target?.ref),
    Math.max(20_000, timeoutMs + 12_000),
    decodeOpenedViewPayload,
  )
  const session = opened.ok ? readyViewSession(opened.data, target) : null
  if (!session) {
    return {
      status: 'unavailable',
      reason: opened.detail || '`astrale view` could not start the preview session.',
    }
  }

  if (target) rememberTarget(root, instance, view.slug, target)
  return session
}

export async function closeViewSession(sessionId: string): Promise<{ ok: true }> {
  if (!/^v-[0-9a-f]+$/.test(sessionId)) return { ok: true }
  await runViewSessionCommand(['view', '--close', sessionId, '--json'], 6000, decodeJsonObject)
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

function runViewSessionCommand<T>(
  args: string[],
  timeoutMs: number,
  decoder: StudioCliDecoder<T>,
): Promise<AstraleResult<T>> {
  const command = viewSessionCommandTail.then(
    () => runAstraleJson(args, timeoutMs, decoder),
    () => runAstraleJson(args, timeoutMs, decoder),
  )
  viewSessionCommandTail = command.then(
    () => undefined,
    () => undefined,
  )
  return command
}

async function runAstraleJson<T>(
  args: string[],
  timeoutMs: number,
  decoder: StudioCliDecoder<T>,
): Promise<AstraleResult<T>> {
  return runStudioCliJson(args, decoder, { timeoutMs })
}
