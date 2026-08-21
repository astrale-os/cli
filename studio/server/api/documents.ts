/** Context-document HTTP transport, including multipart uploads and raw bodies. */
import {
  addDocument,
  deleteDocument,
  listDocuments,
  readDocument,
  updateDocument,
} from '../state/documents'
import { json, notFound, type DomainRouteContext } from './http'

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
      headers: { 'content-type': document.meta.type },
    })
  }

  return null
}

/** JSON document mutations dispatched with the rest of the domain routes. */
export function handleDocumentMutation(context: DomainRouteContext): Response | null {
  const { req, rest, body, handle } = context
  const root = handle.root
  if (rest === '/context/documents/delete' && req.method === 'POST') {
    return json({ ok: deleteDocument(root, body.id) })
  }
  if (rest === '/context/documents/update' && req.method === 'POST') {
    const meta = updateDocument(root, body.id, new TextEncoder().encode(String(body.content ?? '')))
    return meta ? json(meta) : notFound()
  }
  return null
}
