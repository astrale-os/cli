/** CLI-resolved View target discovery and Shell session routes. */
import type { StudioSchemaBundle, ViewInfo } from '../../shared/types'

import { getAnatomy, getBundle } from '../cache'
import { asString } from '../json'
import { studioSettings } from '../studio-settings'
import { getViewRuntime } from '../views/runtime'
import { launchViewSession, releaseViewSession } from '../views/session'
import { badRequest, json, notFound, type DomainRouteContext } from './http'

const VALID_SLUG = /^[a-z][a-z0-9-]*$/

/** The View a `/views/<slug>/…` route addresses, with its bundle and origin, or the error response. */
async function resolveView(
  id: string,
  encodedSlug: string,
): Promise<
  { error: Response } | { view: ViewInfo; bundle: StudioSchemaBundle | null; origin: string }
> {
  const slug = decodeURIComponent(encodedSlug)
  if (!VALID_SLUG.test(slug)) return { error: badRequest('invalid view slug') }
  const anatomy = await getAnatomy(id)
  const view = anatomy?.views.find((candidate) => candidate.slug === slug)
  if (!view) return { error: notFound() }
  const bundle = await getBundle(id)
  const origin = bundle?.ir?.domain || anatomy?.overview.origin
  if (!origin) return { error: badRequest('domain origin is unavailable') }
  return { view, bundle, origin }
}

export async function handleViewRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle } = context
  const root = handle.root

  if (rest === '/views/sessions/release' && req.method === 'POST') {
    return json(await releaseViewSession(asString(body.sessionId) ?? '', asString(body.page)))
  }

  const runtimeMatch = rest.match(/^\/views\/([^/]+)\/runtime$/)
  if (runtimeMatch && req.method === 'GET') {
    const resolved = await resolveView(handle.id, runtimeMatch[1])
    if ('error' in resolved) return resolved.error
    const { view, bundle, origin } = resolved
    return json(
      await getViewRuntime(root, origin, view, bundle, studioSettings().viewProbeTimeoutMs),
    )
  }

  const sessionMatch = rest.match(/^\/views\/([^/]+)\/session$/)
  if (sessionMatch && req.method === 'POST') {
    const resolved = await resolveView(handle.id, sessionMatch[1])
    if ('error' in resolved) return resolved.error
    const { view, bundle, origin } = resolved
    return json(
      await launchViewSession(
        root,
        origin,
        view,
        bundle,
        body,
        studioSettings().viewProbeTimeoutMs,
      ),
    )
  }

  return null
}
