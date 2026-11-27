/**
 * The Studio server's request handler: the guard first, then readiness, the events stream, the
 * JSON API, and the page — proxied to Vite under `--dev`, else the built files.
 */
import type { Notify } from './api/http'

import { handleApi } from './api'
import { refusal, type Audience } from './api/guard'
import { sseResponse } from './api/sse'

export interface StudioRoutes {
  /** who may drive the server; read per request, once the port is bound */
  readonly audience: () => Audience
  /** whether every Domain of the workspace is indexed */
  readonly ready: () => boolean
  /** the Domain ids the events stream greets with */
  readonly domains: () => string[]
  readonly notify: Notify
  /** the Vite dev server under `--dev` */
  readonly vite?: string
  readonly serveStatic: (pathname: string, req: Request) => Response
}

export function studioFetch(routes: StudioRoutes): (req: Request) => Promise<Response> {
  return async (req) => {
    const refused = refusal(req, routes.audience())
    if (refused) return refused
    const url = new URL(req.url)
    if (url.pathname === '/api/ready')
      return new Response(null, {
        status: routes.ready() ? 204 : 503,
        headers: { 'cache-control': 'no-store' },
      })
    if (url.pathname === '/api/events') return sseResponse(routes.domains())
    const api = await handleApi(req, url, routes.notify)
    if (api) return api
    if (routes.vite) {
      return fetch(routes.vite + url.pathname + url.search, {
        headers: req.headers,
        method: req.method,
      }).catch(() => new Response('Vite dev server not reachable', { status: 502 }))
    }
    return routes.serveStatic(url.pathname, req)
  }
}
