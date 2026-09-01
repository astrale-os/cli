/** CLI-resolved View target discovery and Shell session routes. */
import { getAnatomy, getBundle } from '../cache'
import { asString } from '../json'
import { studioSettings } from '../studio-settings'
import { getViewRuntime } from '../views/runtime'
import { closeViewSession, launchViewSession } from '../views/session'
import { badRequest, json, notFound, type DomainRouteContext } from './http'

const VALID_SLUG = /^[a-z][a-z0-9-]*$/

export async function handleViewRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/views/sessions/close' && req.method === 'POST') {
    return json(await closeViewSession(asString(body.sessionId) ?? ''))
  }

  const runtimeMatch = rest.match(/^\/views\/([^/]+)\/runtime$/)
  if (runtimeMatch && req.method === 'GET') {
    const slug = decodeURIComponent(runtimeMatch[1])
    if (!VALID_SLUG.test(slug)) return badRequest('invalid view slug')
    const anatomy = await getAnatomy(id)
    const view = anatomy?.views.find((candidate) => candidate.slug === slug)
    if (!view) return notFound()
    const bundle = await getBundle(id)
    const origin = bundle?.ir?.domain || anatomy?.overview.origin
    if (!origin) return badRequest('domain origin is unavailable')
    return json(
      await getViewRuntime(root, origin, view, bundle, studioSettings().viewProbeTimeoutMs),
    )
  }

  const sessionMatch = rest.match(/^\/views\/([^/]+)\/session$/)
  if (sessionMatch && req.method === 'POST') {
    const slug = decodeURIComponent(sessionMatch[1])
    if (!VALID_SLUG.test(slug)) return badRequest('invalid view slug')
    const anatomy = await getAnatomy(id)
    const view = anatomy?.views.find((candidate) => candidate.slug === slug)
    if (!view) return notFound()
    const bundle = await getBundle(id)
    const origin = bundle?.ir?.domain || anatomy?.overview.origin
    if (!origin) return badRequest('domain origin is unavailable')
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
