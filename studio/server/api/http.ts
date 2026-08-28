/** Internal HTTP contract shared by Studio API route modules. */
import type { StudioEvent } from '../../shared/types'
import type { DomainHandle } from '../domain'
import type { JsonRecord } from '../json'

import { asJsonRecord } from '../json'

export type Notify = (event: StudioEvent) => void

export interface DomainRouteContext {
  req: Request
  url: URL
  rest: string
  body: JsonRecord
  handle: DomainHandle
  notify: Notify
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const notFound = () => json({ error: 'not found' }, 404)
export const badRequest = (message: string) => json({ error: message }, 400)

/** Parse an HTTP JSON body once and keep malformed/non-object payloads untrusted. */
export async function readJsonRecord(req: Request): Promise<JsonRecord> {
  const value: unknown = await req.json().catch(() => undefined)
  return asJsonRecord(value) ?? {}
}

/**
 * Block cross-site state-changing requests. Same-origin browser requests and
 * non-browser clients without Origin/Sec-Fetch-Site remain allowed.
 */
export function crossSiteBlocked(req: Request, url: URL): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false
  const site = req.headers.get('sec-fetch-site')
  if (site) return !(site === 'same-origin' || site === 'none')
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      // Same-origin includes the scheme as well as host and effective port.
      // Comparing only `host` would accept an HTTPS origin for an HTTP Studio.
      return new URL(origin).origin !== url.origin
    } catch {
      return true
    }
  }
  return false
}
