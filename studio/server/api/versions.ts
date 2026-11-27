/**
 * Workspace-level routes: versions, changes, dependencies and compatibility of workspace Domains,
 * the registry, and Publish. A remote fact answers inside the body with its own status, so a route
 * answers 200 with whatever is known; only a malformed request or a refused Publish is an HTTP
 * error. `?fresh=1` reads registry indexes again instead of the briefly kept answers. Routes use
 * the process's service unless a test passes its own.
 *
 * - GET  /api/versions                                  every workspace Domain on disk
 * - GET  /api/registry/domains                          the registry's Domains
 * - GET  /api/registry/versions?origin=                 one origin's Publications
 * - GET  /api/domain/:id/versions                       where the Domain stands
 * - GET  /api/domain/:id/versions/changes               the platform's change report (a look)
 * - GET  /api/domain/:id/versions/dependencies          its dependencies and their versions
 * - GET  /api/domain/:id/versions/compatibility         verdicts for every dependency version
 *        ?origin=&version=  |  ?origin=&local=1         one verdict
 * - POST /api/domain/:id/versions/publish               Publish, streamed as NDJSON events
 */
import type { DomainRouteContext } from './http'

import { isOrigin, isVersion } from '../../shared/contracts/versions'
import { versions, type Versions } from '../workspace/versions/service'
import { badRequest, json } from './http'

const fresh = (url: URL) => url.searchParams.get('fresh') === '1'

/** The origin and version parameters, or why they are not usable. */
function addressOf(url: URL, needsVersion: boolean): { origin: string; version: string } | string {
  const origin = url.searchParams.get('origin') ?? ''
  const version = url.searchParams.get('version') ?? ''
  if (!isOrigin(origin)) return 'origin must be a Domain origin, such as issues.astrale.ai'
  if (needsVersion && !isVersion(version))
    return 'version must be a canonical version, such as 1.2.0'
  return { origin, version }
}

export async function handleVersionsRoute(
  req: Request,
  url: URL,
  versionsOf: () => Versions = versions,
): Promise<Response | null> {
  const path = url.pathname
  if (req.method !== 'GET') return null
  if (path === '/api/versions') return json(await versionsOf().locals())
  if (path === '/api/registry/domains') return json(await versionsOf().registry.domains())
  if (path === '/api/registry/versions') {
    const address = addressOf(url, false)
    if (typeof address === 'string') return badRequest(address)
    return json(await versionsOf().registry.index(address.origin, { fresh: fresh(url) }))
  }
  return null
}

export async function handleDomainVersionsRoute(
  context: DomainRouteContext,
  versionsOf: () => Versions = versions,
): Promise<Response | null> {
  const { req, url, rest, handle, body } = context
  if (rest !== '/versions' && !rest.startsWith('/versions/')) return null
  const service = versionsOf()

  if (req.method === 'POST' && rest === '/versions/publish') {
    const started = await service.publisher.start(handle, body)
    if (!started.ok) return json(started.refusal, started.status)
    return new Response(started.events, {
      headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
    })
  }
  if (req.method !== 'GET') return null

  if (rest === '/versions') return json(await service.standing(handle, { fresh: fresh(url) }))
  if (rest === '/versions/changes') {
    return json(await service.changes.report(handle, { fresh: fresh(url) }))
  }
  if (rest === '/versions/dependencies') {
    return json(await service.dependencies(handle, { fresh: fresh(url) }))
  }
  if (rest === '/versions/compatibility') {
    if (!url.searchParams.has('origin')) {
      return json(await service.compatibility.matrix(handle, { fresh: fresh(url) }))
    }
    const local = url.searchParams.get('local') === '1'
    const address = addressOf(url, !local)
    if (typeof address === 'string') return badRequest(address)
    return json(
      await service.compatibility.verdict(
        handle,
        local ? { origin: address.origin, local: true } : address,
      ),
    )
  }
  return null
}
