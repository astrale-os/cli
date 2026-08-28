/** Context-document HTTP transport, including multipart uploads and raw bodies. */
import { asString } from '../json'
import {
  addDocument,
  deleteDocument,
  listDocuments,
  readDocument,
  updateDocument,
} from '../state/documents'
import { json, notFound, type DomainRouteContext } from './http'

/**
 * Types safe to render in a tab. Everything else downloads instead.
 *
 * The uploader chooses the stored MIME type, and this origin also serves the API
 * that drives a local agent — so an `text/html` (or SVG) document opened from the
 * studio would run its script with the studio's own privileges.
 */
const INLINE_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

export function documentResponseHeaders(type: string, name: string): Record<string, string> {
  const mime = (type.split(';')[0] ?? '').trim().toLowerCase()
  if (INLINE_TYPES.has(mime))
    return {
      'content-type': type,
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    }
  return {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'x-content-type-options': 'nosniff',
  }
}

/** Routes that must run before POST bodies are parsed as JSON. */
export async function handleDocumentTransport(
  req: Request,
  rest: string,
  root: string,
): Promise<Response | null> {
  if (rest === '/context/documents' && req.method === 'GET') return json(listDocuments(root))
  if (rest === '/context/documents' && req.method === 'POST') {
    const form = await req.formData()
    const added = []
    for (const value of form.getAll('files')) {
      if (value instanceof File) {
        added.push(
          addDocument(root, value.name, value.type, new Uint8Array(await value.arrayBuffer())),
        )
      }
    }
    return json(added)
  }

  const raw = rest.match(/^\/context\/documents\/([^/]+)\/raw$/)
  if (raw && req.method === 'GET') {
    const document = readDocument(root, decodeURIComponent(raw[1]))
    if (!document) return notFound()
    return new Response(Bun.file(document.abs), {
      headers: documentResponseHeaders(document.meta.type, document.meta.name),
    })
  }

  return null
}

/** JSON document mutations dispatched with the rest of the domain routes. */
export function handleDocumentMutation(context: DomainRouteContext): Response | null {
  const { req, rest, body, handle } = context
  const root = handle.root
  if (rest === '/context/documents/delete' && req.method === 'POST') {
    return json({ ok: deleteDocument(root, asString(body.id) ?? '') })
  }
  if (rest === '/context/documents/update' && req.method === 'POST') {
    const meta = updateDocument(
      root,
      asString(body.id) ?? '',
      new TextEncoder().encode(asString(body.content) ?? ''),
    )
    return meta ? json(meta) : notFound()
  }
  return null
}
