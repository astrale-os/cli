/** Internal HTTP contract shared by Studio API route modules. */
import type { StudioEvent } from '../../shared/contracts/runtime'
import type { DomainHandle } from '../domain/registry'
import type { JsonRecord } from '../json'

import { REQUEST_LIMITS } from '../../shared/contracts/workspace'
import { asJsonRecord } from '../json'
import { UnreadableState } from '../state/state-file'

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

const MIB = 1024 * 1024

/**
 * A request's body, whole, within `limit` bytes: refused (413) before it is read when it declares
 * a longer length, and as soon as what arrives passes the limit otherwise.
 */
export async function readBody(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () =>
    new RouteRefusal(
      413,
      `a request body here is at most ${limit / MIB} MiB, and this one is larger`,
    )
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) throw tooLarge()
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

/**
 * Parse an HTTP JSON body once, within `REQUEST_LIMITS.json`, and keep malformed/non-object
 * payloads untrusted.
 */
export async function readJsonRecord(req: Request): Promise<JsonRecord> {
  const bytes = await readBody(req, REQUEST_LIMITS.json)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    value = undefined
  }
  return asJsonRecord(value) ?? {}
}

/** A multipart body, within `REQUEST_LIMITS.upload`; one that is not a form is refused (400). */
export async function readUpload(req: Request): Promise<FormData> {
  const bytes = await readBody(req, REQUEST_LIMITS.upload)
  const type = req.headers.get('content-type') ?? ''
  try {
    return await new Response(bytes, { headers: { 'content-type': type } }).formData()
  } catch {
    throw new RouteRefusal(400, 'an upload is sent as a multipart form')
  }
}

/**
 * A request refused where it is read, before or inside its route: answered with its status and
 * sentence by `refusedBy`, the one place a thrown refusal becomes a response.
 */
export class RouteRefusal extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413,
    message: string,
  ) {
    super(message)
    this.name = 'RouteRefusal'
  }
}

/**
 * One percent-encoded path segment, decoded: the one way a route reads an id or a slug from its
 * path. A malformed escape is refused (400) where it is read, never an unhandled error.
 */
export function pathSegment(encoded: string, what: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch {
    throw new RouteRefusal(400, `${what} in the path holds a malformed percent-escape`)
  }
}

/** The response a thrown refusal answers — 409 for a state file not read whole — or nothing. */
export function refusedBy(error: unknown): Response | undefined {
  if (error instanceof UnreadableState) return json(error.body, 409)
  if (error instanceof RouteRefusal) return json({ error: error.message }, error.status)
  return undefined
}
