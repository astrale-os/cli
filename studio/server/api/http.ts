/** Internal HTTP contract shared by Studio API route modules. */
import type { StudioEvent } from '../../shared/contracts/runtime'
import type { DomainHandle } from '../domain/registry'
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

/** The agent's routes are the workspace's: same envelope, no domain to address. */
export interface AgentRouteContext {
  req: Request
  url: URL
  /** the path after `/api` — `/agent`, `/agent/chats`, … */
  rest: string
  body: JsonRecord
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

/** A 400 carrying a thrown error's message. */
export const badRequestFromError = (error: unknown) =>
  badRequest(error instanceof Error ? error.message : String(error))

/** Parse an HTTP JSON body once and keep malformed/non-object payloads untrusted. */
export async function readJsonRecord(req: Request): Promise<JsonRecord> {
  const value: unknown = await req.json().catch(() => undefined)
  return asJsonRecord(value) ?? {}
}
