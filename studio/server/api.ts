/**
 * Studio JSON API composition root. It owns only the public `/api/` boundary,
 * cross-site mutation guard, workspace-vs-domain addressing, and final 404.
 * Capability modules under `api/` own the route implementations.
 */
import { handleDomainRoute } from './api/domain'
import { crossSiteBlocked, json, notFound, type Notify } from './api/http'
import { handleWorkspaceRoute } from './api/workspace'
import { getDomain } from './domain'

export type { Notify } from './api/http'

export async function handleApi(req: Request, url: URL, notify: Notify): Promise<Response | null> {
  const path = url.pathname
  if (!path.startsWith('/api/')) return null
  if (crossSiteBlocked(req, url)) return json({ error: 'cross-site request blocked' }, 403)

  const workspace = await handleWorkspaceRoute(req, path, notify)
  if (workspace) return workspace

  const match = path.match(/^\/api\/domain\/([^/]+)(\/.*)?$/)
  if (!match) return notFound()
  const id = decodeURIComponent(match[1])
  const handle = getDomain(id)
  if (!handle) return notFound()

  return handleDomainRoute({
    req,
    url,
    rest: match[2] ?? '',
    handle,
    notify,
  })
}
