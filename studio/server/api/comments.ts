/** Schema-anchored review comment routes and agent reply merge. */
import { getBundle } from '../cache'
import { schemaRefs } from '../introspect/schema-refs'
import {
  addThreadEntry,
  deleteComment,
  editThreadEntry,
  markOrphans,
  mergeReply,
  readComments,
  setStatus,
  upsertComment,
} from '../state/comments'
import { badRequest, json, notFound, type DomainRouteContext } from './http'

export async function handleCommentRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, rest, body, handle, notify } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/comments') {
    if (req.method === 'GET') {
      const bundle = await getBundle(id)
      const valid = new Set<string>(bundle ? schemaRefs(bundle) : [])
      for (const key of Object.keys(bundle?.overlay.sourceSpans ?? {})) valid.add(key)
      const store = readComments(root)
      for (const comment of store.comments) {
        for (const anchor of comment.anchorRefs) {
          if (anchor.kind !== 'schema') valid.add(anchor.ref)
        }
      }
      return json(markOrphans(root, [...valid]))
    }
    if (body.action === 'create') {
      const bundle = await getBundle(id)
      const comment = upsertComment(root, {
        anchors: body.anchors ?? [],
        anchorRefs: body.anchorRefs ?? [],
        text: body.text,
        firstRole: body.firstRole,
        type: body.type,
        options: body.options,
        schemaVersion: bundle?.renderFingerprint,
      })
      notify({ type: 'comments', domainId: id })
      return json(comment)
    }
    if (body.action === 'reply') {
      const comment = addThreadEntry(root, body.id, body.entry)
      notify({ type: 'comments', domainId: id })
      return comment ? json(comment) : notFound()
    }
    if (body.action === 'edit') {
      const comment = editThreadEntry(root, body.id, body.entryId, String(body.text ?? ''))
      notify({ type: 'comments', domainId: id })
      return comment ? json(comment) : notFound()
    }
    if (body.action === 'status') {
      const comment = setStatus(root, body.id, body.status, body.closeNote)
      notify({ type: 'comments', domainId: id })
      return comment ? json(comment) : notFound()
    }
    if (body.action === 'delete') {
      const ok = deleteComment(root, body.id)
      notify({ type: 'comments', domainId: id })
      return json({ ok })
    }
    return badRequest('unknown comments action')
  }

  if (rest === '/comments/merge' && req.method === 'POST') {
    const bundle = await getBundle(id)
    try {
      const result = mergeReply(root, bundle?.renderFingerprint ?? '', String(body.text ?? ''), {
        dedupeAuthorText: true,
      })
      notify({ type: 'comments', domainId: id })
      return json(result)
    } catch (error: any) {
      return badRequest(String(error?.message ?? error))
    }
  }

  return null
}
