/**
 * Studio JSON API composition root. It owns only the public `/api/` boundary,
 * cross-site mutation guard, workspace-vs-agent-vs-domain addressing, and final 404.
 * Capability modules under `api/` (and `agent/routes.ts`) own the route implementations.
 */
import { handleAgentRoute } from './agent/routes'
import { handleDomainRoute } from './api/domain'
import { crossSiteBlocked, json, notFound, readJsonRecord, type Notify } from './api/http'
import { handleWorkspaceRoute } from './api/workspace'
import { getDomain } from './domain'

export type { Notify } from './api/http'

export async function handleApi(req: Request, url: URL, notify: Notify): Promise<Response | null> {
  const path = url.pathname
  if (!path.startsWith('/api/')) return null
  if (crossSiteBlocked(req, url)) return json({ error: 'cross-site request blocked' }, 403)

  const workspace = await handleWorkspaceRoute(req, path, notify)
  if (workspace) return workspace

  // One agent for the workspace: its routes are not addressed by domain.
  if (path === '/api/agent' || path.startsWith('/api/agent/')) {
    const body = req.method === 'POST' ? await readJsonRecord(req) : {}
    const agent = await handleAgentRoute({
      req,
      url,
      rest: path.slice('/api'.length),
      body,
      notify,
    })
    if (agent) return agent
    return notFound()
  }

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
