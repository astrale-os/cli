import { domainAddressOf } from '../shared/contracts/workspace'
/**
 * Studio JSON API composition root. It owns only the public `/api/` boundary,
 * workspace-vs-agent-vs-domain addressing, and final 404; who may call it at all is
 * decided before it, by the guard (`api/guard.ts`, applied in `serve.ts`).
 * Capability modules under `api/` (and `agent/routes.ts`) own the route implementations.
 */
import { handleAgentRoute } from './agent/routes'
import { handleDomainRoute } from './api/domain'
import { json, notFound, pathSegment, readJsonRecord, refusedBy, type Notify } from './api/http'
import { handleKernelRoute } from './api/kernel'
import { handlePublicationRoute } from './api/publication'
import { handleVersionsRoute } from './api/versions'
import { handleWorkspaceRoute } from './api/workspace'
import { getDomain } from './domain/registry'

/**
 * Answers an `/api/` request, or nothing for another path. A refusal thrown while reading the
 * request or a state file (`RouteRefusal`, `UnreadableState`) is answered here, in one place.
 */
export async function handleApi(req: Request, url: URL, notify: Notify): Promise<Response | null> {
  try {
    return await routeApi(req, url, notify)
  } catch (error) {
    const refused = refusedBy(error)
    if (refused) return refused
    throw error
  }
}

async function routeApi(req: Request, url: URL, notify: Notify): Promise<Response | null> {
  const path = url.pathname
  if (!path.startsWith('/api/')) return null

  const workspace = await handleWorkspaceRoute(req, path, notify)
  if (workspace) return workspace

  const versions = await handleVersionsRoute(req, url)
  if (versions) return versions

  // One agent for the workspace: its routes are not addressed by domain.
  if (path === '/api/agent' || path.startsWith('/api/agent/')) {
    // an image upload is multipart: its route reads the form itself
    const multipart = req.headers.get('content-type')?.startsWith('multipart/form-data')
    const body = req.method === 'POST' && !multipart ? await readJsonRecord(req) : {}
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
  const address = domainAddressOf(pathSegment(match[1]!, 'the Domain id'))
  const rest = match[2] ?? ''
  switch (address.kind) {
    case 'invalid':
      return notFound()
    case 'kernel':
      return readOnlyRefusal('The Kernel Domain', req, rest) ?? handleKernelRoute(req, rest)
    case 'publication':
      return (
        readOnlyRefusal('A Publication', req, rest) ??
        handlePublicationRoute(req, url, rest, address)
      )
    case 'workspace': {
      const handle = getDomain(address.id)
      if (!handle) return notFound()
      return handleDomainRoute({ req, url, rest, handle, notify })
    }
  }
}

/**
 * The one place a write to a Domain the Studio only reads is refused (403): every method but a
 * read, on every route but `/layout` — the reader's own arrangement, kept on this machine.
 */
function readOnlyRefusal(what: string, req: Request, rest: string): Response | undefined {
  if (req.method === 'GET' || req.method === 'HEAD' || rest === '/layout') return undefined
  return json({ error: `${what} is read-only in Studio.` }, 403)
}
