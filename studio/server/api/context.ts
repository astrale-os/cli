/** Authored/automatic agent context and copy-handoff routes. */
import { getBundle } from '../cache'
import { buildCopyMarkdown } from '../handoff/copy'
import { refreshAuto } from '../handoff/service'
import { readComments } from '../state/comments'
import {
  addUserContext,
  deleteContext,
  readContext,
  setAutoInclude,
  updateContext,
} from '../state/context'
import { listDocuments } from '../state/documents'
import { badRequest, json, notFound, type DomainRouteContext } from './http'

export async function handleContextRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle, notify } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/context') {
    if (req.method === 'GET') return json(readContext(root))
    if (body.action === 'add') {
      const item = addUserContext(root, body)
      notify({ type: 'comments', domainId: id })
      return json(item)
    }
    if (body.action === 'update') {
      const item = updateContext(root, body.id, body)
      return item ? json(item) : notFound()
    }
    if (body.action === 'delete') return json({ ok: deleteContext(root, body.id) })
    if (body.action === 'include') {
      const item = setAutoInclude(root, body.id, body.include)
      return item ? json(item) : notFound()
    }
    return badRequest('unknown context action')
  }

  if (rest === '/copy-payload' && req.method === 'POST') {
    await refreshAuto(handle)
    const bundle = await getBundle(id)
    const storedContext = readContext(root)
    const openComments = readComments(root).comments.filter((comment) => comment.status === 'open')
    const markdown = buildCopyMarkdown({
      origin: bundle?.ir?.domain ?? handle.origin ?? id,
      root,
      renderFingerprint: bundle?.renderFingerprint ?? '',
      schemaRevision: bundle?.schemaRevision,
      openComments,
      userContext: storedContext.user,
      autoContext: body.includeAuto
        ? storedContext.auto.filter((item) => item.includeInHandoff)
        : [],
      documents: listDocuments(root),
    })
    return json({ markdown, openComments: openComments.length })
  }

  return null
}
